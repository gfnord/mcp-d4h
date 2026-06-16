# Development

Dev workflow, code style, and the recipe for extending the server.

---

## 1. Setup

```bash
git clone https://github.com/gfnord/mcp-d4h.git
cd mcp-d4h
npm install
npm run build
```

Requirements:

- Node.js **20+**
- npm 10+ (bundled with Node 20)

---

## 2. Scripts

| Script | What it does |
|--------|--------------|
| `npm run build` | One-shot TypeScript compile (`tsc`) into `dist/`. |
| `npm run dev` | `tsc --watch` — recompile on save. |
| `npm start` | `node dist/index.js` — boot the server (build first). |
| `npm run clean` | Remove `dist/`. |
| `npm run prepublishOnly` | `clean + build` — runs automatically on `npm publish`. |

---

## 3. Project layout

```text
mcp-d4h/
├── src/
│   ├── d4h.ts         # Typed axios client + D4HApiError + factory
│   └── index.ts       # MCP server bootstrap + 3 tool registrations
├── docs/
│   ├── architecture.md
│   ├── configuration.md
│   ├── development.md  (this file)
│   └── tools.md
├── dist/              # tsc output (gitignored)
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Code style & quality

### TypeScript strictness

`tsconfig.json` enables:

- `"strict": true` — full strictness, including `strictNullChecks` and
  `noImplicitAny`.
- `"noUnusedLocals"`, `"noUnusedParameters"` — dead code fails the build.
- `"noImplicitReturns"`, `"noFallthroughCasesInSwitch"` — no silent control
  flow bugs.
- `"target": "ES2022"`, `"module": "NodeNext"` — modern Node.js, native ESM.

### Hard rules

- **No `any`**. No `@ts-ignore`. No `@ts-expect-error`. If the SDK types are
  insufficient, widen at the boundary with a real `interface`, never with
  `any`.
- **stdout is sacred.** Only the MCP SDK writes to stdout. Every other log
  line uses `console.error`.
- **No swallowing errors.** Every catch must either rethrow as a
  `D4HApiError` or surface to the LLM via `handleError`.
- **No hidden state.** The server is stateless between tool calls.

### Style conventions

- Two-space indent, double quotes, semicolons.
- Named exports only — no `export default`.
- Async/await everywhere; never mix in raw `.then()`.
- Zod schemas inline at the registration site, not in a shared "schemas"
  module — the schema *is* the tool's contract with the LLM and should live
  next to it.

---

## 5. Recipe: add a new tool

Worked example — let's add `get_incidents` (list incidents owned by the
team). The Team Manager API exposes this at
`GET /v3/team/{teamId}/incidents` (see D4H's
[API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)).

### Step 1 — Extend the client

In [`src/d4h.ts`](../src/d4h.ts), add a typed method to `TeamManagerClient`:

```ts
export interface TeamManagerIncident {
  id: number;
  reference?: string;
  referenceDescription?: string;
  resourceType?: "Incident" | "Event" | "Exercise";
  startsAt?: string;
  endsAt?: string;
  description?: string;
  [key: string]: unknown;
}

// inside class TeamManagerClient { ... }
async listIncidents(params: {
  page?: number;
  size?: number;
  resource_type?: "Incident" | "Event" | "Exercise";
  reference?: string;
  before?: string;
  after?: string;
} = {}): Promise<TeamManagerPage<TeamManagerIncident>> {
  const endpoint = `/team/${this.teamId}/incidents`;
  try {
    const { data } = await this.http.get<TeamManagerPage<TeamManagerIncident>>(
      endpoint,
      { params }
    );
    return data;
  } catch (err) {
    throw wrapAxiosError(err, endpoint);
  }
}
```

Key things to notice:

- Define a typed result interface (even if it's permissive with
  `[key: string]: unknown` — that's the boundary type).
- Always wrap errors with `wrapAxiosError(err, endpoint)` so the MCP layer
  sees a uniform `D4HApiError`.
- The endpoint string used for both the request and error context lives in
  one variable — no drift.

### Step 2 — Register the MCP tool

In [`src/index.ts`](../src/index.ts), add (below the existing tool
registrations):

```ts
server.registerTool(
  "get_incidents",
  {
    title: "List D4H Team Manager incidents",
    description:
      "List incidents, events, and exercises owned by the team. Supports " +
      "filtering by resource type and a free-text reference search.",
    inputSchema: {
      ...paginationShape,
      resource_type: z
        .enum(["Incident", "Event", "Exercise"])
        .optional()
        .describe("Filter by record type."),
      reference: z
        .string()
        .optional()
        .describe("Free-text search across reference number and description."),
      after: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp; only records starting after this time."),
      before: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp; only records starting before this time."),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listIncidents(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_incidents", err);
    }
  }
);
```

Key things to notice:

- Tool name uses `snake_case`.
- Every Zod field has a `.describe(...)` — the LLM uses these to choose
  parameters.
- `requireTeamManager()` throws a precise error if the client isn't
  configured; `handleError` converts it to a proper MCP error result.
- Return type is `Promise<ToolResult>` so TypeScript catches mistakes.

### Step 3 — Build and smoke-test

```bash
npm run build
```

Pipe a `tools/list` call and confirm the new tool appears (see
[Smoke-testing the server](./configuration.md#6-smoke-testing-the-server)).

### Step 4 — Document it

Add a new section to [`docs/tools.md`](./tools.md) following the existing
template (Input, Example call, Example output).

---

## 6. Recipe: add a new region

1. Open [`src/d4h.ts`](../src/d4h.ts).
2. Extend the `D4HRegion` union: `export type D4HRegion = "US" | "EU" | "CA" | "AU";`
3. Add the host to `REGION_HOSTS`.
4. Extend the whitelist check in `resolveRegion()`.
5. Rebuild.

No tool code changes are needed.

---

## 7. Recipe: write a unit test

There are no tests in the initial scaffold (the entire surface is thin HTTP
plumbing). If you want to add Vitest:

```bash
npm i -D vitest @types/node
```

Add to `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

A good first test target is `D4HApiError` formatting and the
`resolveRegion()` whitelist. Use `axios-mock-adapter` or
`vi.spyOn(axios, "create")` to avoid real HTTP.

---

## 8. Releasing

### As a regular dependency

```bash
npm version patch        # or minor / major
npm publish              # runs prepublishOnly => clean + build
git push --follow-tags
```

### As a global bin

```bash
npm install -g .
mcp-d4h                  # boots the server (will fail on missing env, by design)
```

### Tagged GitHub release

After `npm version`, the tag exists locally. Push it:

```bash
git push origin v0.1.1
```

Then either use the GitHub UI or `gh release create v0.1.1 --generate-notes`
to publish a release.

---

## 9. Debugging tips

| Situation | Tip |
|-----------|-----|
| Want to see HTTP traffic | Add axios interceptors that log **to stderr only**: `instance.interceptors.request.use(c => (console.error("[http] →", c.method, c.url), c))`. Never write to stdout. |
| Want to see what the LLM is calling | Add a `console.error` at the top of each tool handler (logging the tool name + arg keys). Don't log values — they may contain PII. |
| Need to step through with a debugger | `node --inspect-brk dist/index.js`, then attach Chrome DevTools or VS Code. Note the host won't be talking to it — pipe JSON-RPC manually. |
| The host says "server crashed" | Check the host's MCP log. Reproduce locally with the smoke-test snippet in [`docs/configuration.md`](./configuration.md#6-smoke-testing-the-server). |

---

## 10. Pull requests

When opening a PR:

1. Build is green (`npm run build`).
2. Every new tool has a matching section in [`docs/tools.md`](./tools.md).
3. Architecture changes are reflected in
   [`docs/architecture.md`](./architecture.md).
4. No new top-level dependencies without a one-line justification in the PR
   description.
