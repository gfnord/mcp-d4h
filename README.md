# mcp-d4h

[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![MCP](https://img.shields.io/badge/MCP-stdio-blueviolet)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
> LLM hosts (Claude Desktop, etc.) talk to the **D4H Team Manager API**
> (spec version 7.0.1, URL prefix `/v3`) — read personnel, qualifications,
> and equipment — through one stdio MCP server.

```text
┌─────────────────┐  stdio JSON-RPC   ┌──────────────────┐   HTTPS    ┌──────────────────────┐
│ Claude Desktop  │ ◀───────────────▶ │     mcp-d4h      │ ─────────▶ │ D4H Team Manager API │
│ (or any MCP     │                   │  (this server)   │            │      (v7.0.1, /v3)   │
│  host)          │                   │                  │            └──────────────────────┘
└─────────────────┘                   └──────────────────┘
```

> See D4H's own [API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)
> for background on Personal Access Tokens and the Team Manager API surface.

---

## Tools

| Tool                    | What it does                                                            |
|-------------------------|-------------------------------------------------------------------------|
| `get_members`           | List/search team members with status, role, and contact info.           |
| `get_member_efficiency` | List qualifications and training awards (optionally per-member).        |
| `get_equipment`         | Search equipment inventory by status, location, owner, kind, ref, etc.  |

All tools return structured JSON. Errors come back as MCP error results with a
descriptive message — the server itself never crashes on a failed API call.

See **[docs/tools.md](./docs/tools.md)** for full input schemas, examples, and
output shapes.

---

## Quick start

### Option A — Install from npm (recommended for end users)

The package is published as **[`@gfnord/mcp-d4h`](https://www.npmjs.com/package/@gfnord/mcp-d4h)**
on the public npm registry. No clone needed — point your MCP host directly at
it via `npx`. Skip to [Wire it into Claude Desktop](#wire-it-into-claude-desktop)
below for the config snippet.

If you want the `mcp-d4h` command on your PATH:

```bash
npm install -g @gfnord/mcp-d4h
mcp-d4h --help    # or just `mcp-d4h` to boot the stdio server
```

The same package is also mirrored to **GitHub Packages** at
`https://npm.pkg.github.com`. Installing from there requires a GitHub PAT
with `read:packages` scope and an `.npmrc` entry — most users should prefer
public npm.

### Option B — Clone and build from source (for development)

```bash
git clone https://github.com/gfnord/mcp-d4h.git
cd mcp-d4h
npm install
npm run build

cp .env.example .env       # fill in PAT + team ID
npm start                  # boots the stdio server
```

The compiled entry is **`dist/index.js`** and is also exposed as a `mcp-d4h`
bin if you `npm link` or `npm install -g .`.

> Requirements: **Node.js 20+** and a D4H **Personal Access Token**
> ([how to generate](./docs/configuration.md#3-generating-a-personal-access-token-pat)).

---

## Configuration

Minimum environment variables:

| Variable                   | Required | Description                                              |
|----------------------------|----------|----------------------------------------------------------|
| `D4H_TEAM_MANAGER_API_KEY` | **yes**  | PAT scoped for the Team Manager API.                     |
| `D4H_TEAM_ID`              | **yes**  | Numeric team ID (from your Team Manager URL).            |
| `D4H_REGION`               | no       | `US` (default), `EU`, or `CA`.                           |
| `D4H_HTTP_TIMEOUT_MS`      | no       | Per-request HTTP timeout in ms. Default `30000`.         |

If credentials are missing, the server still boots — tool calls simply return
a clean "client not configured" error.

Full reference: **[docs/configuration.md](./docs/configuration.md)**.

---

## Wire it into Claude Desktop

Edit the host config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux / WSL2: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Recommended (uses the published npm package — zero local setup):**

```json
{
  "mcpServers": {
    "d4h": {
      "command": "npx",
      "args": ["-y", "@gfnord/mcp-d4h"],
      "env": {
        "D4H_TEAM_MANAGER_API_KEY": "tm_pat_xxxxxxxxxxxxxxxx",
        "D4H_TEAM_ID": "12345",
        "D4H_REGION": "US"
      }
    }
  }
}
```

**Alternative (point at a local clone):**

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

Restart Claude Desktop. The three `d4h` tools will appear and become callable
by the model.

---

## Documentation

| Doc | Topic |
|-----|-------|
| **[docs/architecture.md](./docs/architecture.md)** | System design, request lifecycle, error model, security |
| **[docs/tools.md](./docs/tools.md)** | Per-tool reference: inputs, outputs, examples |
| **[docs/configuration.md](./docs/configuration.md)** | Env vars, PAT generation, regions, troubleshooting |
| **[docs/development.md](./docs/development.md)** | Dev workflow, adding tools, code style, release |

---

## Project layout

```text
mcp-d4h/
├── src/
│   ├── d4h.ts         # Typed axios client for the Team Manager API
│   └── index.ts       # MCP server + tool registrations + stdio bootstrap
├── docs/              # Architecture, tools, config, dev docs
├── dist/              # tsc build output (gitignored)
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## License

MIT — see [LICENSE](./LICENSE).
