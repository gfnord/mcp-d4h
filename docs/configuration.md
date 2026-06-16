# Configuration

Everything the server needs is read from **environment variables** at process
start. There is no config file, no CLI flags, no runtime reconfiguration.

---

## 1. Environment variables

| Variable                          | Required | Default | Description |
|-----------------------------------|----------|---------|-------------|
| `D4H_TEAM_MANAGER_API_KEY`        | **yes**  | —       | Personal Access Token scoped for the Team Manager API. |
| `D4H_TEAM_ID`                     | **yes**  | —       | Numeric team ID (visible in your Team Manager URL). |
| `D4H_REGION`                      | no       | `US`    | One of `US`, `EU`, `CA`. Controls the host suffix used for the API. |
| `D4H_HTTP_TIMEOUT_MS`             | no       | `30000` | Per-request HTTP timeout in milliseconds. |

The server is **permissive**: if credentials are missing, it still boots and
each tool call returns a clean error explaining what's missing. This is
useful during development and host-config debugging.

If `D4H_REGION` is set to something other than `US`/`EU`/`CA`, the process
exits at startup with a descriptive stderr message.

---

## 2. `.env` file

For local development, copy the template:

```bash
cp .env.example .env
```

…and fill in the values. The server calls `dotenv.config()` on startup, so
any variables in `.env` are merged into `process.env`.

> `.env` is gitignored. Never commit secrets.

For production-style deployment (e.g. as a Claude Desktop MCP server),
**don't** rely on `.env` — inject values directly via the host's MCP
config `env` block. See the README's Claude Desktop snippet.

---

## 3. Generating a Personal Access Token (PAT)

See D4H's own [API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)
and [Obtaining an API Access Key](https://help.d4h.com/article/377-obtaining-an-api-access-key)
for screenshots. Short version:

1. Sign in to D4H.
2. Click your avatar → **Manage Account** → **Personal Access Tokens**.
3. Click **Create Token**. Scope it to **Team Manager** for least privilege.
4. Copy the token immediately — D4H will not show it again.

> Security: PATs grant access on behalf of your user. Treat them like
> passwords. The server reads the PAT only from environment variables and
> never logs its value. All HTTP transport is HTTPS.

### Why a dedicated PAT for this server?

- **Blast-radius isolation.** If the PAT leaks (e.g. from a Claude Desktop
  config sync gone wrong), only this server's surface is affected and you
  can revoke just this token without touching other integrations.
- **Per-integration audit trails.** D4H attributes API actions to the PAT's
  owning user; a dedicated PAT makes the audit log unambiguous.
- **Easy rotation.** Rotate this one token on a schedule without disrupting
  other tools that talk to D4H.

---

## 4. Regions

| Region | Team Manager host                       |
|--------|------------------------------------------|
| `US`   | `api.team-manager.us.d4h.com`            |
| `EU`   | `api.team-manager.eu.d4h.com`            |
| `CA`   | `api.team-manager.ca.d4h.com`            |

If your tenant lives on a different region, add an entry to `REGION_HOSTS`
in [`src/d4h.ts`](../src/d4h.ts) and extend the `D4HRegion` union.

---

## 5. Host-side configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "d4h": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-d4h/dist/index.js"],
      "env": {
        "D4H_TEAM_MANAGER_API_KEY": "tm_pat_xxxxxxxxxxxxxxxx",
        "D4H_TEAM_ID": "12345",
        "D4H_REGION": "US"
      }
    }
  }
}
```

Config file locations:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux / WSL2:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after editing.

### Other MCP hosts

Any host that speaks MCP over stdio works. The host just needs to:

1. Spawn `node /path/to/mcp-d4h/dist/index.js` as a child process.
2. Provide the env vars above in the child's environment.
3. Speak MCP JSON-RPC over the child's stdin/stdout.

---

## 6. Smoke-testing the server

Without any host, you can pipe a single JSON-RPC request to verify the
server is up:

```bash
# List tools
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  | node dist/index.js
```

You should see, on stdout:

```text
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}}, ...
```

…and, on stderr:

```text
[mcp-d4h] Region=US TeamManager=missing
[mcp-d4h] MCP server ready on stdio.
```

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `Team Manager client is not configured.` | `D4H_TEAM_MANAGER_API_KEY` and/or `D4H_TEAM_ID` not set in the host's env. |
| `HTTP 401 invalid_token` | PAT is invalid, revoked, or expired. Generate a fresh one. |
| `HTTP 401` but token "looks right" | The PAT may be scoped to the wrong API surface. Confirm in D4H → Manage Account → Personal Access Tokens. |
| `HTTP 403` | PAT is valid but lacks permission for that resource. |
| `HTTP 404` | `D4H_TEAM_ID` is wrong, or you have no membership of that team. |
| `timeout of 30000ms exceeded` | Slow D4H response. Increase `D4H_HTTP_TIMEOUT_MS`. |
| `Unsupported D4H_REGION "..."` | Set `D4H_REGION` to one of `US`, `EU`, `CA`. |
| MCP host shows no tools / "server failed to start" | Check the host's own MCP log. The server logs to **stderr**; the host should surface it. For Claude Desktop, see `~/Library/Logs/Claude/mcp*.log` on macOS or the equivalent on Linux. |
| Server appears to hang | Something else may be writing to stdout (e.g. a wrapper script using `console.log`). Stdout is reserved for MCP wire framing. |

---

## 8. Security checklist

- [ ] Use a **dedicated PAT** scoped to the Team Manager API for this server.
- [ ] Never commit `.env`. Verify it's listed in `.gitignore` (it is).
- [ ] Treat the host config (e.g. `claude_desktop_config.json`) like a
      secrets file — back it up encrypted, don't sync it through unencrypted
      channels.
- [ ] Rotate the PAT on staff turnover.
- [ ] If you later add mutating tools, gate them behind an explicit opt-in
      env flag and document the audit-log implications.
