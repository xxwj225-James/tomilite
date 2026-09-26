# TomiLite — Security Design

TomiLite is open source (MIT). Since the source is public, the security model focuses on **protecting user data at rest and in transit** — not on hiding code.

## Threat Model

- **Local-first app**: all user data lives in a local SQLite database (`~/.tomilite/`), no cloud dependency
- **Single user**: no multi-tenant isolation needed; the API rejects non-localhost requests without the token (see Network)
- **External MCP clients**: Claude Code and other AI tools may call TomiLite's MCP server — these are gated by API keys + human-in-the-loop (HITL) approval
- **Outbound MCP servers**: TomiLite's agent may call external MCP servers — credentials are encrypted and never sent to the LLM

## Data Protection

### API Keys & Secrets

- LLM provider keys: encrypted with AES-256-GCM (`apps/api/src/lib/crypto.ts`), encryption key stored in `~/.tomilite/.encryption_key`
- MCP server credentials: same AES-256-GCM scheme; masked (`xxxx****abcd`) when returned to the UI
- MCP API keys (inbound): SHA-256 hashed at rest (`apps/api/src/routers/apikey.ts`)
- Redmine API keys: same AES-256-GCM scheme, stored under `SystemConfig['redmine.config']` and **never returned to the renderer** — `redmine.getConfig` reports only whether a key is set. Saving a config with an empty key field keeps the existing key, so "change the URL only" does not require retyping the secret
- Secrets never reach the LLM — the agent passes only server/tool names; credentials are injected server-side

> **A key that reads as plaintext may be unencrypted, or may be undecryptable.**
> `crypto.decrypt` returns its input unchanged when it is not a three-part payload, and
> swallows an authentication failure. So `testConnection` is the only thing that can tell
> "this was never encrypted" apart from "the encryption key file changed and this can no
> longer be read" — the stored text is identical in both cases. Treat a Redmine connection
> that suddenly fails with an unchanged config as a possible `.encryption_key` problem
> before suspecting the server.

### Plain `http://` to Redmine — an intentional exception

The Redmine connector accepts and defaults to plain `http://` when no scheme is given, and
does **not** require HTTPS. This is deliberate: an intranet Redmine reached over the
corporate LAN is the normal deployment, and requiring TLS here would exclude most of the
users the feature exists for. The consequences, stated plainly:

- The API key travels in the `X-Redmine-API-Key` request header in clear text on that leg,
  readable by anything on the path. The settings UI says so next to the address field when
  a plain-`http` URL is entered, in all three languages
- The key still never leaves the local machine for any other destination, and is encrypted
  at rest

> **Do not "fix" this by applying the agent's SSRF guard here.** `fetch_url` blocks private
> and loopback addresses because an LLM chose that URL and must not be pointed at the LAN.
> The Redmine connector is the opposite case: a **user**, in settings, typed the address of
> their own company's server, and the entire feature is "reach the intranet host". Applying
> the private-address block to this connector would break it for every enterprise user while
> protecting against nothing the user did not already intend. The two paths look similar in
> code and have opposite threat models; the guard belongs on the LLM-reachable one only.

### Network

- The API server listens on all interfaces (`server.listen(PORT)` in `apps/api/src/server.ts`), but non-localhost requests are rejected with 403 unless they present the persisted API token: a random token is generated once, stored at `~/.tomilite/.api_token` (mode 0600), and passed to the Electron renderer via the URL hash (`#tl_token=...`); requests must send it as `X-TL-Token` or `Authorization: Bearer`. Localhost is exempt
- **`/api/mcp` and `/api/mcp.*` are exempt from the desktop token by design** (the predicate is exact: `/api/mcp`, or `/api/mcp.` followed by a procedure name — `/api/mcpServer.*` does not match). An MCP client authenticates with an API key, not the desktop token, and has no way to obtain the latter. The exemption is therefore only meaningful for a **non-localhost** caller, which is why this line can be verified by reading it and not by running anything on one machine
  - That exemption is deliberate and is the whole reason the key exists: the inbound MCP surface is reachable without the desktop token, so the API key is the only thing standing in front of it. Keep it hashed at rest, scoped, and revocable
  - Browsers: `X-Api-Key` and the `Mcp-*` headers are in `Access-Control-Allow-Headers`. Before this, a browser preflight for any MCP call failed outright, and no MCP request could be made from a page at all
  - The StreamableHTTP handler additionally refuses a request whose `Origin` is present and not localhost (**403**), and answers `GET`/`DELETE` with **405** — there is no SSE stream and no session to enumerate
- Outbound MCP connections enforce HTTPS for remote hosts; plain HTTP allowed only for localhost (`apps/api/src/agent/mcp/client.ts`)
- **The Redmine connector is the one outbound path that accepts plain HTTP to a non-localhost host on purpose** — see [Plain `http://` to Redmine](#plain-http-to-redmine--an-intentional-exception) for why, and why the private-address guard must not be extended to it
- Web search and Redmine requests both respect the system proxy (from `apps/api/src/agent/utils/proxy.ts`); the proxy is a hard requirement for an intranet Redmine reached from outside the LAN, not a nicety
  - "Respect" is three registry values, not one: `ProxyEnable` (whether it is on at all), `ProxyServer` (the address), and `ProxyOverride` (the bypass list). Reading `ProxyServer` alone sent every web search through a proxy the user had already switched off — Windows clears `ProxyEnable` but leaves `ProxyServer` behind — and also proxied hosts the user had explicitly excluded. A request that a bypassed or dead proxy would carry is the one case where the app falls back to a direct connection: those are the calls whose failure is otherwise a silently empty result

## MCP Human-in-the-Loop (HITL)

Write operations from external MCP clients are risk-gated:

| Risk                      | Behavior                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `read_only`               | Executes directly                                                                               |
| `low` / `medium` / `high` | Queued for approval in the MCP panel; auto-approved only when the API key's HITL mode is `auto` |

Every external call is audited in `McpAuditLog` (tool, arguments, status, approver).

### Scopes are enforced (since v2.6.0)

`ApiKey.scopes` is a comma-separated list, default `read,write`. A key that does not carry
`write` is refused any tool whose risk is not `read_only`. Before v2.6.0 the column was
stored, displayed and never consulted — a key named for reading could call `delete_issue`.
Every pre-existing key already held `read,write`, so enabling the check changed nothing for
them; the gap only mattered once a third-party client held a key, which is exactly what the
transport layer in §6.1 of [mcp-client.md](mcp-client.md) makes possible.

### `ApiKey.expiresAt` is stored and shown, but NOT enforced — known gap

Keys are created with an expiry, the value is displayed in Settings → API Keys, and nothing
compares it to the current time. An expired key still authenticates. This is a deliberate
omission rather than an oversight: `expiresAt` is a `String` column, its format has never
been verified across the rows already in the wild, and a comparison written against the
wrong assumption would lock every existing key out at once. Enforcing it is a small change
that needs a storage audit first. Until then, treat expiry as a note to yourself, and
**revoke** a key you want to stop trusting.

## Build & Packaging (no security-by-obfuscation)

- TomiLite does **not** obfuscate its code. The security model relies on data-at-rest encryption and the local-first architecture, not on hiding source code (the project is MIT-licensed and public)
- The frontend is minified with **Terser** for release builds (`apps/web/vite.config.ts`, selective-minify plugin: `drop_console`, `drop_debugger`; sourcemaps are disabled in production builds); the Milkdown vendor chunk is minified with esbuild
- The API server is bundled with esbuild into `apps/api/dist/server.cjs` (`scripts/bundle-api.js`) — bundled but not minified
- `scripts/clean-engines.js` removes non-Windows Prisma engine binaries from the installer to shrink its size

## Dependency Advisories

Dependabot watches `package-lock.json`. Most entries in it are transitive — a package
we never call directly, pulled in by one we do. The root `package.json` therefore
carries an `overrides` block that pins those transitives to a patched release:

| Package                    | Pinned    | Why an override, not a plain bump                                                                                |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `@xmldom/xmldom`           | `^0.8.15` | `mammoth` / `plist` accept `^0.8.x`; staying on 0.8 avoids a major jump                                          |
| `fast-uri`                 | `^3.1.6`  | nested under `app-builder-lib`'s `ajv`                                                                           |
| `js-yaml`                  | `^4.3.2`  | pulled in by `electron-updater`, `eslint`, `electron-builder`                                                    |
| `nodemailer`               | `^9.1.1`  | `imapflow` and `mailparser` **pin exact versions** (`9.0.1`, `9.0.5`) — an override is the only way to move them |
| `baseline-browser-mapping` | `^2.11.0` | nested under `browserslist`                                                                                      |
| `image-size`               | `^2.0.4`  | `pptxgenjs` still declares `^1.2.1`; the patched release is a major jump, so only an override reaches it         |

`browserslist` itself is a **devDependency** rather than an override: npm does not apply
an override to a package that another dependency consumes as a _peer_ (`update-browserslist-db`
peers on it), so pinning it at the root is the only lever that works.

Direct dependencies are bumped in the manifest instead:

| Package                         | From       | To         | Fixes                                                                       |
| ------------------------------- | ---------- | ---------- | --------------------------------------------------------------------------- |
| `@huggingface/transformers`     | `4.2.0`    | `4.3.0`    | inherits `onnxruntime-node` 1.30.0 (clears `adm-zip` < 0.6.0) and `sharp`     |
| `sharp`                         | `^0.34.5`  | `^0.35.4`  | libvips CVEs + libheif; also the version `transformers` 4.3.0 requires        |
| `mailparser` (`packages/email`) | `^3.9.15`  | `^3.9.28`  | moves `html-to-text` to 10.0.1, which depends on `deepmerge-ts` 8.x          |

**`image-size` — was accepted risk, now fixed.** Two advisories (ICNS infinite loop;
JXL/HEIF infinite loops) covered every version published up to `2.0.2`, so this was
recorded here as accepted risk. The patched `2.0.4` is now published, and the override
above pins it; `pptxgenjs` (its only consumer here) still declares `^1.2.1`, so a plain
bump is not possible. The vulnerable parsers run only on `addImage`, and our single
`pptxgenjs` call site (`exportToPptx` → `markdownToDeck` in
`apps/api/src/agent/tools/reportTools.ts`) draws slides with `addSlide` / `addText` only —
so even before the pin the affected code was never reached.

Note that a dependency fix only reaches users after the next **release**: the API server
is bundled into `apps/api/dist/server.cjs` at pack time and that directory is gitignored.

## Reporting a Vulnerability

Please report security issues via [GitHub Issues](https://github.com/xxwj225-James/tomilite/issues) — avoid publishing details of exploitable vulnerabilities before a fix is released.
