# Tools Reference

Every tool exposed by `mcp-d4h` is documented here with its **input schema**,
**output shape**, an **example call**, and the **D4H endpoint** it hits.

Tools registered: **13** (all D4H Team Manager API, spec v7.0.1, URL prefix `/v3`).

| Tool                                | Section |
|-------------------------------------|---------|
| `get_members`                       | [↓](#get_members) |
| `get_member`                        | [↓](#get_member) |
| `get_qualifications`                | [↓](#get_qualifications) |
| `get_member_qualification_awards`   | [↓](#get_member_qualification_awards) |
| `get_incidents`                     | [↓](#get_incidents) |
| `get_incident`                      | [↓](#get_incident) |
| `get_exercises`                     | [↓](#get_exercises) |
| `get_events`                        | [↓](#get_events) |
| `get_attendance`                    | [↓](#get_attendance) |
| `get_groups`                        | [↓](#get_groups) |
| `get_tasks`                         | [↓](#get_tasks) |
| `get_equipment`                     | [↓](#get_equipment) |
| `search_team`                       | [↓](#search_team) |

---

## Common conventions

- **Pagination** is **offset-based**:
  - `page` (zero-indexed), `size` (1–100, default 20).
  - Response envelope: `{ results, page, pageSize, totalSize }`.
  - Exception: `/search` returns `totalSize: -1` (the registry does not compute a total for global search).
- **Authentication** uses `Authorization: Bearer <PAT>` (see
  [D4H API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)).
- **Detail endpoints** (`get_member`, `get_incident`) take a numeric `id` as
  the only required argument.
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

## `get_member`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/members/{id}`

Get the full detail record for one team member.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id`  | integer | **yes** | Numeric member ID (the `id` field from `get_members`). |

### Example call

```json
{ "name": "get_member", "arguments": { "id": 1234 } }
```

### Example output (truncated)

```json
{
  "id": 1234,
  "name": "Jane Doe",
  "status": "OPERATIONAL",
  "resourceType": "Member",
  "countReportingHours": 412,
  "countRollingHours": 78,
  "customFieldValues": { "...": "..." },
  "createdAt": "2018-09-04T12:00:00.000Z"
}
```

---

## `get_qualifications`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/member-qualifications`

> **⚠️ Breaking change in v0.2.0.** This tool was previously named
> `get_member_efficiency` and its description claimed it returned per-member
> awards. The endpoint actually returns the qualification **DEFINITIONS
> catalog**; the old `member_id` parameter was a no-op because award records
> aren't on this endpoint. For per-member awards use the new
> [`get_member_qualification_awards`](#get_member_qualification_awards).

List the team's qualification definitions catalog — i.e. the *templates* /
*kinds* of qualifications the team tracks (CPR, Swiftwater, etc.), with their
default cost, reminder window, and expiry months.

### Input

| Field   | Type | Required | Description |
|---------|------|----------|-------------|
| `page`  | integer ≥ 0 | no | Page number. |
| `size`  | integer 1–100 | no | Page size. |
| `title` | string | no | Filter by qualification title (e.g. `"CPR"`). |

### Example call

```json
{ "name": "get_qualifications", "arguments": { "title": "CPR" } }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 9876,
      "title": "CPR",
      "description": "Basic CPR + AED certification",
      "cost": 75.0,
      "expiredCost": 100.0,
      "reminderDays": 30,
      "expiresMonthsDefault": 24,
      "resourceType": "MemberQualification"
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 42
}
```

---

## `get_member_qualification_awards`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/member-qualification-awards`

Per-member qualification awards — who holds what and when does it expire.
This is the readiness data. Use [`get_qualifications`](#get_qualifications)
for the catalog of qualification kinds.

### Input

| Field       | Type | Required | Description |
|-------------|------|----------|-------------|
| `page`      | integer ≥ 0 | no | Page number. |
| `size`      | integer 1–100 | no | Page size. |
| `member_id` | integer | no | Server-side filter to awards held by this member ID. |

### Example call

```json
{ "name": "get_member_qualification_awards", "arguments": { "member_id": 1234 } }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 555,
      "resourceType": "MemberQualificationAward",
      "member":        { "id": 1234, "resourceType": "Member" },
      "qualification": { "id": 9876, "resourceType": "MemberQualification", "title": "CPR" },
      "startsAt": "2025-04-12T00:00:00.000Z",
      "endsAt":   "2027-04-12T00:00:00.000Z"
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 8
}
```

---

## `get_incidents`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/incidents`

List incidents (real responses). Distinct from training exercises and routine
events — all three resources have the same field shape, but live at separate
endpoints.

### Input

| Field       | Type | Required | Description |
|-------------|------|----------|-------------|
| `page`      | integer ≥ 0 | no | Page number. |
| `size`      | integer 1–100 | no | Page size. |
| `reference` | string | no | Filter by reference number / search. |
| `before`    | ISO 8601 string | no | Only activities starting before this timestamp. |
| `after`     | ISO 8601 string | no | Only activities starting after this timestamp. |

### Example call

```json
{ "name": "get_incidents", "arguments": { "size": 5, "after": "2026-01-01T00:00:00Z" } }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 186332,
      "resourceType": "Incident",
      "reference": "00079",
      "referenceDescription": "Hiker fall — Falls Lake",
      "startsAt": "2026-04-25T20:06:00.000Z",
      "endsAt":   "2026-04-26T01:42:00.000Z",
      "countAttendance": 14,
      "percAttendance": 88,
      "night": true,
      "owner": { "id": 501, "resourceType": "Team" }
    }
  ],
  "page": 0,
  "pageSize": 5,
  "totalSize": 62
}
```

---

## `get_incident`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/incidents/{id}`

Get the full detail record for one incident.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id`  | integer | **yes** | Numeric incident ID (the `id` field from `get_incidents`). |

### Example call

```json
{ "name": "get_incident", "arguments": { "id": 186332 } }
```

### Example output (truncated)

```json
{
  "id": 186332,
  "resourceType": "Incident",
  "reference": "00079",
  "description": "Subject located in scree field at GR…",
  "plan": "Two ground teams plus rope rescue stand-by…",
  "location": { "type": "Point", "coordinates": [-123.123, 49.456] },
  "startsAt": "2026-04-25T20:06:00.000Z",
  "endsAt":   "2026-04-26T01:42:00.000Z",
  "customFieldValues": { "...": "..." }
}
```

---

## `get_exercises`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/exercises`

List training exercises. Same record shape as `get_incidents`; `resourceType`
is `"Exercise"`.

### Input

Same as `get_incidents`: `page`, `size`, `reference`, `before`, `after`.

### Example call

```json
{ "name": "get_exercises", "arguments": { "after": "2026-01-01T00:00:00Z" } }
```

---

## `get_events`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/events`

List routine events (meetings, community engagements, fundraisers). Same
record shape as `get_incidents`; `resourceType` is `"Event"`.

### Input

Same as `get_incidents`: `page`, `size`, `reference`, `before`, `after`.

### Example call

```json
{ "name": "get_events", "arguments": { "size": 10 } }
```

---

## `get_attendance`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/attendance`

List attendance records. Each record links a member to an activity
(incident/event/exercise) with a status and duration.

### Input

| Field       | Type | Required | Description |
|-------------|------|----------|-------------|
| `page`      | integer ≥ 0 | no | Page number. |
| `size`      | integer 1–100 | no | Page size. |
| `member_id` | integer | no | Filter to attendance records for this member ID. |
| `status`    | string | no | Filter by attendance status (e.g. `"ATTENDING"`, `"ABSENT"`). |

### Example call

```json
{ "name": "get_attendance", "arguments": { "member_id": 1234, "status": "ATTENDING" } }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 9001,
      "resourceType": "ActivityAttendance",
      "member":   { "id": 1234,   "resourceType": "Member" },
      "activity": { "id": 186332, "resourceType": "Incident" },
      "status":   "ATTENDING",
      "duration": 19800,
      "startsAt": "2026-04-25T20:06:00.000Z",
      "endsAt":   "2026-04-26T01:36:00.000Z"
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 412
}
```

---

## `get_groups`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/member-groups`

List personnel groups (sub-teams) — e.g. "ground team A", "rope rescue",
"tech rescue".

> D4H also exposes `/handler-groups` and `/animal-groups` for K9 ops.
> Intentionally not wrapped — this server targets non-K9 SAR. To add them,
> see [docs/development.md §5](./development.md#5-recipe-add-a-new-tool).

### Input

| Field   | Type | Required | Description |
|---------|------|----------|-------------|
| `page`  | integer ≥ 0 | no | Page number. |
| `size`  | integer 1–100 | no | Page size. |
| `title` | string | no | Filter by group title. |

### Example call

```json
{ "name": "get_groups", "arguments": {} }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 11,
      "title": "Ground team A",
      "resourceType": "MemberGroup",
      "membershipResourceType": "MemberGroupMembership",
      "required": false,
      "owner": { "id": 7, "resourceType": "Organisation" }
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 24
}
```

---

## `get_tasks`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/tasks`

List tasks (action items, follow-ups, equipment repairs), optionally assigned
to members and optionally linked to a target resource.

### Input

| Field                | Type | Required | Description |
|----------------------|------|----------|-------------|
| `page`               | integer ≥ 0 | no | Page number. |
| `size`               | integer 1–100 | no | Page size. |
| `status`             | string | no | Filter by status (`"NOT_STARTED"`, `"IN_PROGRESS"`, `"COMPLETED"`). |
| `assigned_member_id` | integer | no | Filter to tasks assigned to this member ID. |

### Example call

```json
{ "name": "get_tasks", "arguments": { "status": "NOT_STARTED" } }
```

### Example output (truncated)

```json
{
  "results": [
    {
      "id": 77,
      "ref": "TASK-077",
      "resourceType": "Task",
      "status": "NOT_STARTED",
      "description": "Replace rope #14 (worn sheath)",
      "dueAt": "2026-07-01T00:00:00.000Z",
      "owner": { "id": 501, "resourceType": "Team" }
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalSize": 5
}
```

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

## `search_team`

> **Method:** `GET` · **Path:** `/v3/team/{D4H_TEAM_ID}/search`

Heterogeneous global search across resource types. Returns mixed results
(members, incidents, equipment, etc.) where each hit carries a `resourceType`
indicating its kind.

> Use this when the LLM doesn't know which resource type a term refers to
> (a name might be a person, a vehicle, or an incident reference).

> ⚠️ The envelope's `totalSize` is **`-1`** for this endpoint — the registry
> does not compute it. Page through until `results` is shorter than `size`.

### Input

| Field           | Type | Required | Description |
|-----------------|------|----------|-------------|
| `query`         | string | **yes** | The search query string. |
| `page`          | integer ≥ 0 | no | Page number. |
| `size`          | integer 1–100 | no | Page size. |
| `resource_type` | string[] | no | Restrict to specific kinds (e.g. `["Member", "Incident"]`). |
| `sort`          | string | no | Sort field name. |
| `order`         | string | no | Sort order: typically `"asc"` or `"desc"`. |

### Example call

```json
{ "name": "search_team", "arguments": { "query": "rope rescue", "size": 5 } }
```

### Example output (truncated)

```json
{
  "results": [
    { "id": 11,    "title": "Ground team A — Rope Rescue", "resourceType": "MemberGroup" },
    { "id": 186332, "title": "Incident 00079", "resourceType": "Incident" }
  ],
  "page": 0,
  "pageSize": 5,
  "totalSize": -1
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
// Detail endpoint with bad ID
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error: D4H API /team/12345/incidents/999999 failed (HTTP 404): {\"title\":\"Not Found\"}" }]
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
