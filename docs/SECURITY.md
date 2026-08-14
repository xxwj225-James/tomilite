# TomiLite — Security Design

TomiLite is open source (MIT). Since the source is public, the security model focuses on **protecting user data at rest and in transit** — not on hiding code.

## Threat Model

- **Local-first app**: all user data lives in a local SQLite database (`~/.tomilite/`), no cloud dependency
- **Single user**: no multi-tenant isolation needed; the API binds to localhost
- **External MCP clients**: Claude Code and other AI tools may call TomiLite's MCP server — these are gated by API keys + human-in-the-loop (HITL) approval
- **Outbound MCP servers**: TomiLite's agent may call external MCP servers — credentials are encrypted and never sent to the LLM

## Data Protection

### API Keys & Secrets

- LLM provider keys: encrypted with AES-256-GCM (`apps/api/src/lib/crypto.ts`), encryption key stored in `~/.tomilite/.encryption_key`
- MCP server credentials: same AES-256-GCM scheme; masked (`xxxx****abcd`) when returned to the UI
- MCP API keys (inbound): SHA-256 hashed at rest (`apps/api/src/routers/apikey.ts`)
- Secrets never reach the LLM — the agent passes only server/tool names; credentials are injected server-side

### Network

- API server binds to localhost only; the Electron shell passes a random API token for non-localhost origins (`apps/api/src/server.ts`)
- Outbound MCP connections enforce HTTPS for remote hosts; plain HTTP allowed only for localhost
- Web search requests respect the system proxy

## MCP Human-in-the-Loop (HITL)

Write operations from external MCP clients are risk-gated:

| Risk | Behavior |
|------|----------|
| `read_only` | Executes directly |
| `low` / `medium` / `high` | Queued for approval in the MCP panel; auto-approved only when the API key's HITL mode is `auto` |

Every external call is audited in `McpAuditLog` (tool, arguments, status, approver).

## Reporting a Vulnerability

Please report security issues via [GitHub Issues](https://github.com/xxwj225-James/tomilite/issues) — avoid publishing details of exploitable vulnerabilities before a fix is released.
