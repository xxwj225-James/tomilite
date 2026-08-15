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
- Secrets never reach the LLM — the agent passes only server/tool names; credentials are injected server-side

### Network

- The API server listens on all interfaces (`server.listen(PORT)` in `apps/api/src/server.ts`), but non-localhost requests are rejected with 403 unless they present the persisted API token: a random token is generated once, stored at `~/.tomilite/.api_token` (mode 0600), and passed to the Electron renderer via the URL hash (`#tl_token=...`); requests must send it as `X-TL-Token` or `Authorization: Bearer`. Localhost is exempt
- Outbound MCP connections enforce HTTPS for remote hosts; plain HTTP allowed only for localhost (`apps/api/src/agent/mcp/client.ts`)
- Web search requests respect the system proxy (`apps/api/src/agent/utils/proxy.js`)

## MCP Human-in-the-Loop (HITL)

Write operations from external MCP clients are risk-gated:

| Risk                      | Behavior                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `read_only`               | Executes directly                                                                               |
| `low` / `medium` / `high` | Queued for approval in the MCP panel; auto-approved only when the API key's HITL mode is `auto` |

Every external call is audited in `McpAuditLog` (tool, arguments, status, approver).

## Build & Packaging (no security-by-obfuscation)

- TomiLite does **not** obfuscate its code. The security model relies on data-at-rest encryption and the local-first architecture, not on hiding source code (the project is MIT-licensed and public)
- The frontend is minified with **Terser** for release builds (`apps/web/vite.config.ts`, selective-minify plugin: `drop_console`, `drop_debugger`; sourcemaps are disabled in production builds); the Milkdown vendor chunk is minified with esbuild
- The API server is bundled with esbuild into `apps/api/dist/server.cjs` (`scripts/bundle-api.js`) — bundled but not minified
- `scripts/clean-engines.js` removes non-Windows Prisma engine binaries from the installer to shrink its size

## Reporting a Vulnerability

Please report security issues via [GitHub Issues](https://github.com/xxwj225-James/tomilite/issues) — avoid publishing details of exploitable vulnerabilities before a fix is released.
