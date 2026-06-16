# Using `mcp-d4h` with Claude Desktop

Step-by-step guide to wire `@gfnord/mcp-d4h` into [Claude Desktop](https://claude.ai/download)
so the model can call D4H Team Manager directly from a chat.

> **TL;DR for the impatient**
> ```json
> {
>   "mcpServers": {
>     "d4h": {
>       "command": "npx",
>       "args": ["-y", "@gfnord/mcp-d4h"],
>       "env": {
>         "D4H_TEAM_MANAGER_API_KEY": "tm_pat_xxxx",
>         "D4H_TEAM_ID": "12345",
>         "D4H_REGION": "US"
>       }
>     }
>   }
> }
> ```
> Paste into `claude_desktop_config.json`, restart Claude Desktop, done.
> If you're on WSL2 and Claude Desktop runs on Windows, jump to
> [§3 — WSL2 + Windows host](#wsl2--windows-host-gotcha) first.

---

## 1. Prerequisites

You need three values **before** editing the config file. Have them ready in a
scratch buffer.

| Value | How to get it |
|---|---|
| **D4H Team Manager PAT** | D4H web UI → click your avatar → **Manage Account** → **Personal Access Tokens** → **Create Token**. Scope it to **Team Manager only** for least privilege. Copy immediately — D4H shows the token exactly once. See [configuration.md §3](./configuration.md#3-generating-a-personal-access-token-pat) for screenshots. |
| **Team ID** | Numeric value visible in your Team Manager URL, e.g. `https://team-manager.us.d4h.com/team/`**`12345`**`/...` → use `12345`. |
| **Region** | `US` (default) / `EU` / `CA`. Match the host suffix of your D4H tenant URL. |

You also need **Node.js 20+** somewhere Claude Desktop can reach:

- macOS / Linux: just install Node on the system Claude Desktop runs on
  (`brew install node` / `apt install nodejs` / [nodejs.org](https://nodejs.org))
- Windows: install Node on the Windows side ([nodejs.org](https://nodejs.org)
  or `winget install OpenJS.NodeJS`) **even if you develop in WSL2** — see
  [§3](#wsl2--windows-host-gotcha) for why

---

## 2. Locate Claude Desktop's MCP config file

| OS | Config file path |
|---|---|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** (native Claude Desktop) | `~/.config/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

If the file doesn't exist yet, create it with a single empty object:

```json
{}
```

### Quick way to open it

| Platform | Command |
|---|---|
| macOS | `open ~/Library/Application\ Support/Claude/claude_desktop_config.json` |
| Linux | `xdg-open ~/.config/Claude/claude_desktop_config.json` |
| Windows | `Win+R` → paste `%APPDATA%\Claude` → Enter → open `claude_desktop_config.json` in Notepad or VS Code |

---

## 3. Add the `d4h` server block

### Standard config (Linux / macOS / Windows with Node installed)

Add a `d4h` entry under `mcpServers`. If you already have other MCP servers
configured, **insert next to them** — do not replace the whole `mcpServers`
block.

```json
{
  "mcpServers": {
    "d4h": {
      "command": "npx",
      "args": ["-y", "@gfnord/mcp-d4h"],
      "env": {
        "D4H_TEAM_MANAGER_API_KEY": "PASTE_YOUR_PAT_HERE",
        "D4H_TEAM_ID": "12345",
        "D4H_REGION": "US"
      }
    }
  }
}
```

`npx -y` will download and cache the package on first launch (~5 seconds the
first time, instant after that). No clone, no build, no global install needed.

### WSL2 + Windows host gotcha

**This is the single most common stumbling block.** If your code lives in
WSL2 but Claude Desktop runs on the **Windows host** (the typical setup),
Windows cannot spawn `node` or `npx` from inside WSL — they're on a different
filesystem in a different OS namespace.

Two ways to fix it:

#### Option A (recommended) — Install Node on Windows alongside WSL

1. Install Node 20+ on Windows: download from [nodejs.org](https://nodejs.org)
   or run `winget install OpenJS.NodeJS` in PowerShell.
2. Verify in **Windows** PowerShell:
   ```powershell
   node --version
   npx --version
   ```
3. Use the standard JSON snippet above unchanged. Claude Desktop will spawn
   the Windows-side `npx`, which will download `@gfnord/mcp-d4h` from npm
   and execute it on the Windows-side Node.

> Your WSL2 development environment stays untouched. Windows-side Node is
> only there as a launcher for Claude Desktop.

#### Option B — Spawn into WSL via `wsl.exe`

If you absolutely don't want Node on Windows, you can have Claude Desktop
shell out into your WSL distro:

```json
{
  "mcpServers": {
    "d4h": {
      "command": "wsl.exe",
      "args": [
        "-d", "Ubuntu",
        "--",
        "bash", "-lc",
        "exec npx -y @gfnord/mcp-d4h"
      ],
      "env": {
        "D4H_TEAM_MANAGER_API_KEY": "PASTE_YOUR_PAT_HERE",
        "D4H_TEAM_ID": "12345",
        "D4H_REGION": "US"
      }
    }
  }
}
```

> - Replace `Ubuntu` with your actual distro name. List your distros from
>   PowerShell with `wsl.exe -l -v`.
> - `bash -lc` ensures `~/.bashrc`/`~/.profile` runs so `npx` is on `PATH`
>   (especially important if you use `nvm`).
> - `exec` replaces the bash process so signals from Claude Desktop reach
>   the Node process cleanly.

Option A is generally smoother. Option B avoids a duplicate Node install but
adds a small startup cost and more failure modes.

### Alternative: run from a local clone (for development)

If you've cloned the repo for development, you can point Claude Desktop at
your local `dist/index.js` instead of the npm package:

```json
{
  "mcpServers": {
    "d4h": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-d4h/dist/index.js"],
      "env": { "D4H_TEAM_MANAGER_API_KEY": "...", "D4H_TEAM_ID": "...", "D4H_REGION": "US" }
    }
  }
}
```

Useful for testing changes before they're tagged and published.

---

## 4. Restart Claude Desktop

Claude Desktop only loads MCP config **at launch**. Editing the JSON while
the app is running has no effect until restart.

**Fully quit, don't just close the window:**

| OS | How to fully quit |
|---|---|
| macOS | ⌘+Q, or right-click dock icon → Quit |
| Linux | System tray icon → Quit, or `pkill -f Claude` |
| Windows | System tray (near clock) → right-click → Quit |

Then reopen.

---

## 5. Verify the server loaded

In a new conversation, look for the tool indicator in the input area
(🔧 / "Search and tools" / similar — UI varies by version). You should see:

- A server named **`d4h`**
- With **25 tools** total, grouped as:
  - **13 read tools** — `get_members`, `get_member`, `get_qualifications`, `get_member_qualification_awards`, `get_incidents`, `get_incident`, `get_exercises`, `get_events`, `get_attendance`, `get_groups`, `get_tasks`, `get_equipment`, `search_team`
  - **9 mutating tools** — `create_event`, `create_exercise`, `create_incident`, `update_event`, `update_exercise`, `update_incident`, `create_equipment`, `update_equipment`, `add_member_qualification` (all default to `dry_run: true` — preview before sending)
  - **3 unavailable stubs** — `assign_equipment_to_member`, `unassign_equipment_from_member`, `update_member_qualification` (registered for discoverability; return a structured "unavailable" response pointing at the D4H web interface)

If `d4h` is missing or shows 0 tools, check the Claude Desktop MCP log:

| OS | Log path |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp*.log` |
| Linux | `~/.config/Claude/logs/mcp*.log` |
| Windows | `%APPDATA%\Claude\logs\mcp*.log` |

The healthy startup lines (written by `mcp-d4h` to **stderr** — which
Claude Desktop forwards to its logs):

```text
[mcp-d4h] Region=US TeamManager=configured
[mcp-d4h] MCP server ready on stdio.
```

If it says `TeamManager=missing`, the env vars never reached the process.
Re-check the JSON for typos, trailing commas, or quote mismatches.

---

## 6. Smoke-test with real prompts

Try these in a new Claude conversation, in order of risk.

### Read tool — `get_members`

> List my **operational** D4H team members — give me the first 5 with their
> name and position.

What happens:
1. Claude calls `get_members` with `{ status: "OPERATIONAL", size: 5 }`.
2. You see a "Used **d4h**" / 🔧 indicator in the response.
3. Claude formats the JSON response into a readable list.

### Read tool — `get_member_qualification_awards`

> What qualifications does member ID **12345** hold? Are any expiring
> in the next 90 days?

→ Claude calls `get_member_qualification_awards` with `{ member_id: 12345 }`,
then filters/highlights records with an `endsAt` inside the 90-day window.

### Read tool — `get_equipment`

> Show me all operational handheld radios in the team inventory, with their
> reference numbers and current locations.

→ Claude calls `get_equipment` with `{ status: "OPERATIONAL", text: "radio" }`.

### Mutating tool — `dry_run` flow (safe — no API call)

> Plan creating an exercise titled "Saturday rope rescue" from 8 AM to 4 PM
> next Saturday.

What happens:
1. Claude calls `create_exercise` with `{ startsAt, endsAt, referenceDescription }`.
2. Because `dry_run` defaults to **true**, the server returns a **preview**:
   the resolved `POST https://api.team-manager.<region>.d4h.com/v3/team/<id>/exercises`
   URL and the JSON body that *would* be sent.
3. Claude shows you the preview. Nothing was sent to D4H.

### Mutating tool — `needsMoreInfo` flow

> Schedule an exercise called "Quick swiftwater drill" for 9 AM Sunday.

What happens:
1. Claude calls `create_exercise` with `startsAt` and `referenceDescription` but **no `endsAt`**.
2. Server returns `needsMoreInfo`: *"Cannot create this exercise yet. I still
   need: end time (endsAt) — ISO 8601 datetime. What is the end time?"*
3. Claude relays the question to you. **Nothing was sent to D4H** — no
   fabricated default `endsAt`.

### Unavailable stub

> Assign equipment 204937 to member 20816.

What happens:
1. Claude calls `assign_equipment_to_member`.
2. Server returns the `unavailable` response explaining that PATCH `/equipment/{id}`
   rejects location-mutating fields and pointing at the D4H web interface.
3. Claude relays the unavailability and (typically) suggests the web UI.

### Mutating tool — actual send (`dry_run: false`)

Only after you've previewed and reviewed:

> Now actually create that exercise.

→ Claude re-invokes `create_exercise` with `dry_run: false`. The record is
created in D4H. You receive the created record back.

If the read prompts return sensible data and the mutating flow goes
dry-run → preview → review → send without surprises, **end-to-end is
working**. You can now use Claude to read personnel, qualifications,
incidents, equipment, and (with `dry_run: false` confirmation) to create
events, exercises, incidents, equipment items, and qualification awards.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `d4h` server doesn't appear in tool list | Claude Desktop couldn't spawn the process | Check `mcp*.log`. On WSL2+Windows, almost always the launcher issue from [§3](#wsl2--windows-host-gotcha). |
| Server starts but every tool call returns `"Team Manager client is not configured"` | env vars didn't reach the process | Re-check JSON for typos / trailing commas / mismatched quotes. Confirm both `D4H_TEAM_MANAGER_API_KEY` and `D4H_TEAM_ID` are present. |
| `HTTP 401 invalid_token` | PAT typo, expired, or scoped to the wrong API | Regenerate the PAT at D4H → Manage Account → Personal Access Tokens. Scope it to Team Manager only. |
| `HTTP 403 Forbidden` | PAT valid but lacks permission for the resource | Check the PAT's scopes; talk to your D4H team admin. |
| `HTTP 404 /team/{id}/members` | Wrong `D4H_TEAM_ID`, or you don't belong to that team | Confirm the numeric ID from your Team Manager URL. |
| First call is slow (~5s), subsequent calls fast | Expected — `npx -y` is fetching the tarball on first run | No fix needed; the package is then cached. |
| Server appears, lists tools, then "disconnects" | Usually a write to stdout outside the MCP frame (a wrapper script using `console.log`, an `npm install` log line in cache mode, etc.) | If using Option B (`wsl.exe`), make sure you're not running any login script that prints to stdout. Use `bash -c` instead of `bash -lc` to skip profile scripts as a quick test. |
| `Unsupported D4H_REGION "..."` | Typo in the region value | Set `D4H_REGION` to one of `US`, `EU`, `CA` (case-insensitive). |

For more detail, see [docs/configuration.md §7](./configuration.md#7-troubleshooting)
(error matrix for all hosts) and [docs/tools.md](./tools.md) (per-tool
input/output reference).

---

## 8. Updating the server

When a new version of `@gfnord/mcp-d4h` is released:

- **If using `npx -y`** (recommended config): nothing to do. `npx` checks
  the registry on each launch and downloads the latest version
  automatically. Just restart Claude Desktop to pick it up.
- **If you used `npm install -g`**: run `npm install -g @gfnord/mcp-d4h@latest`,
  then restart Claude Desktop.
- **If you cloned the source**: `git pull && npm install && npm run build`,
  then restart Claude Desktop.

Check the current published version any time with:

```bash
npm view @gfnord/mcp-d4h version
```

Release history: [GitHub Releases](https://github.com/gfnord/mcp-d4h/releases).

---

## See also

- [README](../README.md) — project overview and quick start
- [docs/tools.md](./tools.md) — full input/output reference for all 25 tools (read, mutating, and unavailable stubs)
- [docs/configuration.md](./configuration.md) — env vars, PAT generation, region details
- [docs/architecture.md](./architecture.md) — how the server is wired internally
- [docs/development.md](./development.md) — dev workflow, adding tools, release process
