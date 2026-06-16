# Tools Reference

Every tool exposed by `mcp-d4h` is documented here with its **input schema**,
**output shape**, an **example call**, and the **D4H endpoint** it hits.

Tools registered: **3** (all D4H Team Manager API, spec v7.0.1, URL prefix `/v3`).

| Tool                    | Section |
|-------------------------|---------|
| `get_members`           | [↓](#get_members) |
| `get_member_efficiency` | [↓](#get_member_efficiency) |
| `get_equipment`         | [↓](#get_equipment) |

---

## Common conventions

- **Pagination** is **offset-based**:
  - `page` (zero-indexed), `size` (1–100, default 20).
  - Response envelope: `{ results, page, pageSize, totalSize }`.
- **Authentication** uses `Authorization: Bearer <PAT>` (see
  [D4H API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)).
- **All errors** come back as MCP results with `isError: true` and a single
  `text` content block describing what went wrong. The server does not crash.

---

## `get_members`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/members`

List or search team members.

### Input

| Field    | Type | Required | Description |
|----------|------|----------|-------------|
| `page`   | integer ≥ 0 | no | Page number (default 0). |
| `size`   | integer 1–100 | no | Page size (default 20). |
| `status` | enum | no | One of `OPERATIONAL`, `NON_OPERATIONAL`, `OBSERVER`, `RETIRED`. |
| `search` | string | no | Free-text search across name and contact fields. |

### Example call

```json
{
  "name": "get_members",
  "arguments": { "status": "OPERATIONAL", "size": 50 }
}
```

### Example output (truncated)

```json
{
  "results": [
    { "id": 1234, "name": "Jane Doe", "status": "OPERATIONAL", "position": "Team Leader" },
    { "id": 1235, "name": "John Roe", "status": "OPERATIONAL", "position": "Medic" }
  ],
  "page": 0,
  "pageSize": 50,
  "totalSize": 87
}
```

---

## `get_member_efficiency`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/member-qualifications`

List qualifications and training awards for the team. Optionally filter
client-side to a single member.

### Input

| Field       | Type | Required | Description |
|-------------|------|----------|-------------|
| `page`      | integer ≥ 0 | no | Page number. |
| `size`      | integer 1–100 | no | Page size. |
| `title`     | string | no | Filter by qualification title (e.g. `"CPR"`). |
| `member_id` | integer | no | If given, results are filtered to qualifications whose `member.id` matches. The original page metadata is preserved and a `filteredByMemberId` field is added. |

### Example call

```json
{
  "name": "get_member_efficiency",
  "arguments": { "member_id": 1234 }
}
```

### Example output

```json
{
  "results": [
    { "id": 9876, "title": "CPR", "awardedAt": "2025-04-12T00:00:00Z", "expiresAt": "2027-04-12T00:00:00Z", "member": { "id": 1234, "name": "Jane Doe" } }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 412,
  "filteredByMemberId": 1234
}
```

> **Note**: `totalSize` reflects the underlying server-side page total; the
> `results` array is filtered after the fetch. If you need to be sure you've
> seen everything for a member, page through until `totalSize` is exhausted.

---

## `get_equipment`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/equipment`

Search the equipment inventory.

### Input

| Field         | Type | Required | Description |
|---------------|------|----------|-------------|
| `page`, `size` | int | no | Pagination. |
| `status` | enum | no | One of `OPERATIONAL`, `UNSERVICEABLE`, `RETIRED`, `LOST`, `WISHLIST`, `INACTIVE`. |
| `ref` | string | no | Exact equipment reference number. |
| `text` | string | no | Free-text search. |
| `location_id` | integer | no | Filter by location. |
| `member_id` | integer | no | Filter by assigned member. |
| `kind_id` | integer | no | Filter by equipment kind. |
| `category_id` | integer | no | Filter by category. |

### Example call

```json
{
  "name": "get_equipment",
  "arguments": { "status": "OPERATIONAL", "text": "radio" }
}
```

### Example output (truncated)

```json
{
  "results": [
    { "id": 42, "ref": "000042", "status": "OPERATIONAL", "kind": { "id": 8, "title": "Handheld Radio" }, "location": { "id": 3, "title": "Bay 1" } }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 14
}
```

---

## Error responses

Every tool can return an error result. Typical shapes:

```json
// Missing credentials
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error: Unexpected error: Team Manager client is not configured. Set D4H_TEAM_MANAGER_API_KEY and D4H_TEAM_ID." }]
}
```

```json
// D4H API rejected the request
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error: D4H API /team/12345/members failed (HTTP 401): {\"error\":\"invalid_token\"}" }]
}
```

```json
// Network failure / timeout
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error: D4H API /team/12345/equipment failed: timeout of 30000ms exceeded" }]
}
```

See [Troubleshooting](./configuration.md#7-troubleshooting) for what each
HTTP status typically means.
