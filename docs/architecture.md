# Architecture

> This document describes the internal design of `mcp-d4h`: the components,
> the request lifecycle, the error model, and the security boundaries.

---

## 1. High-level picture

`mcp-d4h` is a thin, stateless bridge between an MCP host and the **D4H Team
Manager API** (spec version 7.0.1, URL prefix `/v3`). It owns no business
logic of its own — it just exposes well-typed tools that map 1:1 to D4H
endpoints.

```mermaid
flowchart LR
    Host["MCP Host<br/>(Claude Desktop, etc.)"]

    subgraph mcp-d4h
      Boot["Bootstrap<br/>src/index.ts (top)"]
      Server["McpServer<br/>(@modelcontextprotocol/sdk)"]
      Tools["3 Registered Tools<br/>get_members, get_member_efficiency, get_equipment"]
      Client["Team Manager Client<br/>src/d4h.ts"]
      ErrModel["D4HApiError<br/>+ handleError"]
    end

    TM["D4H Team Manager API<br/>api.team-manager.&lt;region&gt;.d4h.com/v3"]

    Host <-- stdio JSON-RPC --> Server
    Boot -->|builds & registers| Server
    Server --> Tools
    Tools -->|invokes typed methods| Client
    Client -->|HTTPS Bearer PAT| TM
    Client -->|axios errors| ErrModel
    ErrModel -->|isError: true result| Server
```

**Wire protocol**: MCP JSON-RPC framed as one JSON message per line over
**stdin/stdout**.
**Outbound protocol**: plain HTTPS with `Authorization: Bearer <PAT>` —
exactly as documented in D4H's
[API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide).

There is no persistence layer, no shared state between tool calls, and no
background work. Every tool invocation is an isolated request/response.

---

## 2. Components

### 2.1 Bootstrap — top of [`src/index.ts`](../src/index.ts)

Responsibilities:

1. Load `.env` (if present) via `dotenv`.
2. Build the client from `process.env` using `buildClientsFromEnv`.
   - Missing credentials do **not** throw at startup — the client is simply
     left undefined.
   - Invalid `D4H_REGION` is fatal (process exits with a clear stderr message).
3. Log a one-line readiness summary to **stderr**:

   ```text
   [mcp-d4h] Region=US TeamManager=configured
   ```

4. Construct the `McpServer`, register the 3 tools, connect a
   `StdioServerTransport`.

### 2.2 Team Manager Client — [`src/d4h.ts`](../src/d4h.ts)

A thin axios wrapper around the Team Manager API at
`https://api.team-manager.<region>.d4h.com/v3`.

Design choices:

| Decision | Rationale |
|----------|-----------|
| One axios instance per client | Locks in `baseURL`, default headers, and timeout. No per-call header repetition. |
| Region-driven host resolution | `REGION_HOSTS` lookup, no string interpolation at call sites. |
| `D4HApiError` thrown on failure | Single error type carries `status`, `endpoint`, and a redacted body summary. |
| Permissive factory | `buildClientsFromEnv` returns an empty `clients.teamManager` when credentials are missing, never throws. |

### 2.3 MCP Server — middle of [`src/index.ts`](../src/index.ts)

Uses `McpServer.registerTool(name, config, handler)` from the official SDK
(v1.x). Each tool:

1. Declares a **Zod input schema** with `.describe()` annotations on every
   field (the LLM uses these descriptions to drive parameter selection).
2. Calls `requireTeamManager()` — this throws a precise error string if the
   client isn't configured, which `handleError` converts into an MCP error
   result.
3. Returns either `okJson(data)` (structured `text` content of JSON) or, on
   failure, an `isError: true` result.

### 2.4 Transport — bottom of [`src/index.ts`](../src/index.ts)

`StdioServerTransport` from
`@modelcontextprotocol/sdk/server/stdio.js`. No arguments, no configuration —
it owns the process's stdin/stdout for the MCP wire protocol.

---

## 3. Request lifecycle

A single tool invocation:

```mermaid
sequenceDiagram
    autonumber
    participant H as MCP Host
    participant S as McpServer
    participant T as Tool Handler
    participant C as Team Manager Client
    participant API as D4H Team Manager API

    H->>S: JSON-RPC tools/call (stdin)
    S->>S: validate against Zod input schema
    S->>T: handler(parsedArgs)
    T->>T: requireTeamManager()
    T->>C: client.listMembers({...})
    C->>API: HTTPS GET /v3/team/{id}/members + Bearer PAT
    API-->>C: JSON body (or HTTP error)
    alt success
      C-->>T: typed result
      T-->>S: okJson(result)
    else axios error
      C-->>T: throws D4HApiError(status, endpoint, body)
      T-->>S: handleError → { isError: true, content: [text] }
    end
    S-->>H: JSON-RPC response (stdout)
```

**Critical invariant**: every byte ever written to **stdout** is part of the
MCP wire protocol. Every log line goes to **stderr** via `console.error`.

---

## 4. Error model

All errors funnel through a single shape so the LLM gets a uniform
explanation regardless of where the failure came from.

| Source | Class / Path | Surfaced as |
|--------|--------------|-------------|
| Missing credentials | `requireTeamManager()` throws `Error` | `isError: true`, `"Error: Unexpected error: Team Manager client is not configured. Set D4H_TEAM_MANAGER_API_KEY and D4H_TEAM_ID."` |
| HTTP non-2xx from D4H | `D4HApiError` | `isError: true`, `"Error: D4H API /team/12345/members failed (HTTP 401): {...}"` |
| Network / timeout | `D4HApiError` (no `status`) | `isError: true`, includes axios's message |
| Programmer bug | generic `Error` | `isError: true`, `"Error: Unexpected error: ..."` (also logged to stderr) |
| Schema validation | thrown by Zod inside SDK before handler runs | standard MCP JSON-RPC error reply |

`D4HApiError` carries `status`, `endpoint`, and a **truncated** JSON summary
of the response body (max 500 chars) so error messages are useful without
dumping huge payloads at the LLM.

---

## 5. Security model

| Concern | Mitigation |
|---------|-----------|
| Credential leakage | PAT read only from `process.env`. Never logged. Never appears in MCP responses. The redacted error body summary is truncated at 500 chars and is the response body, not the request headers. |
| Stdout corruption | All diagnostics go to stderr. Stdout is reserved for MCP framing. |
| Region misconfig | `D4H_REGION` is whitelisted (US/EU/CA). Anything else fails fast at boot. |
| TLS | All HTTP via `https://` — axios defaults to verifying CA certs. No insecure mode. |
| Input fuzzing from the LLM | Every tool input is validated by a Zod schema before the handler runs. Enums (`status`, etc.) are constrained. Pagination caps `size ≤ 100`. |

---

## 6. Region handling

Region resolution is done **once** at boot in
[`resolveRegion()`](../src/d4h.ts) and looked up in `REGION_HOSTS`:

```ts
const REGION_HOSTS: Record<D4HRegion, string> = {
  US: "api.team-manager.us.d4h.com",
  EU: "api.team-manager.eu.d4h.com",
  CA: "api.team-manager.ca.d4h.com",
};
```

To add a new region, extend the `D4HRegion` union and `REGION_HOSTS` map.
No other call sites need to change.

---

## 7. Extension points

| Need | Where to extend |
|------|-----------------|
| New D4H endpoint | Add a typed method to `TeamManagerClient` in `src/d4h.ts`. |
| New MCP tool | Add `server.registerTool(...)` block in `src/index.ts` and a Zod schema. Reuse `okJson` / `handleError`. |
| New region | Append to `REGION_HOSTS` + `D4HRegion` union. |
| Pagination helper | Wrap the client's list methods with an async iterator that follows the `totalSize`/`page` envelope. |
| Resource exposure (read-only MCP `resources/`) | Add `server.registerResource(...)` next to the tools — the SDK exposes the same factory pattern. |
| Prompt templates | Same pattern with `server.registerPrompt(...)`. |

See **[docs/development.md](./development.md)** for the step-by-step "add a
new tool" walkthrough.

---

## 8. What's intentionally NOT here

These are deliberate omissions, not oversights:

- **No retry / backoff.** D4H's rate limits are tenant-specific; the host
  layer (or a calling LLM agent) is a better place to decide on retries.
- **No response caching.** Tool calls are explicit user/LLM-driven actions;
  staleness risk outweighs the latency win.
- **No multiplexing across teams.** One server process = one team. If you
  need multi-team routing, run multiple `mcp-d4h` instances under different
  host entries (`d4h-team-a`, `d4h-team-b`, …).
- **No write tools.** All current endpoints are read-only. If you add
  mutating tools (e.g. attendance updates), gate them behind an explicit
  opt-in env flag and document the audit-log implications clearly.
- **No streaming results.** All tool results are returned as a single JSON
  payload. The MCP `text` content model fits that naturally.
