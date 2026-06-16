# Tools Reference

Every tool exposed by `mcp-d4h` is documented here with its **input schema**,
**output shape**, an **example call**, and the **D4H endpoint** it hits.

Tools registered: **25** (all D4H Team Manager API, spec v7.0.1, URL prefix `/v3`).

- **13 read** tools (`get_*`, `search_team`)
- **9 mutating** tools (`create_*`, `update_*`, `add_member_qualification`) — all default `dry_run: true`
- **3 unavailable stubs** (`update_member_qualification`, `assign_equipment_to_member`, `unassign_equipment_from_member`) — registered for discoverability; return a structured "unavailable" response pointing at the D4H web interface

| Tool                                | Kind | Section |
|-------------------------------------|------|---------|
| `get_members`                       | read | [↓](#get_members) |
| `get_member`                        | read | [↓](#get_member) |
| `get_qualifications`                | read | [↓](#get_qualifications) |
| `get_member_qualification_awards`   | read | [↓](#get_member_qualification_awards) |
| `get_incidents`                     | read | [↓](#get_incidents) |
| `get_incident`                      | read | [↓](#get_incident) |
| `get_exercises`                     | read | [↓](#get_exercises) |
| `get_events`                        | read | [↓](#get_events) |
| `get_attendance`                    | read | [↓](#get_attendance) |
| `get_groups`                        | read | [↓](#get_groups) |
| `get_tasks`                         | read | [↓](#get_tasks) |
| `get_equipment`                     | read | [↓](#get_equipment) |
| `search_team`                       | read | [↓](#search_team) |
| `create_event`                      | mutate | [↓](#create_event) |
| `create_exercise`                   | mutate | [↓](#create_exercise) |
| `create_incident`                   | mutate | [↓](#create_incident) |
| `update_event`                      | mutate | [↓](#update_event) |
| `update_exercise`                   | mutate | [↓](#update_exercise) |
| `update_incident`                   | mutate | [↓](#update_incident) |
| `create_equipment`                  | mutate | [↓](#create_equipment) |
| `update_equipment`                  | mutate | [↓](#update_equipment) |
| `assign_equipment_to_member`        | ⛔ unavailable | [↓](#assign_equipment_to_member) |
| `unassign_equipment_from_member`    | ⛔ unavailable | [↓](#unassign_equipment_from_member) |
| `add_member_qualification`          | mutate | [↓](#add_member_qualification) |
| `update_member_qualification`       | ⛔ unavailable | [↓](#update_member_qualification) |

---

## Common conventions

### Read tools

- **Pagination** is **offset-based**:
  - `page` (zero-indexed), `size` (1–100, default 20).
  - Response envelope: `{ results, page, pageSize, totalSize }`.
  - Exception: `/search` returns `totalSize: -1` (the registry does not compute a total for global search).
- **Authentication** uses `Authorization: Bearer <PAT>` (see
  [D4H API Quick Start Guide](https://help.d4h.com/article/374-api-quick-start-guide)).
- **Detail endpoints** (`get_member`, `get_incident`) take a numeric `id` as
  the only required argument.

### Mutating tools (create_*, update_*, add_member_qualification)

- Every mutating tool accepts a **`dry_run` boolean parameter, defaulting to `true`**.
  - `dry_run: true` (or omitted) → the tool validates inputs and returns a **structured preview** of the HTTP request that *would* be sent. No request is sent.
  - `dry_run: false` → the request is actually sent to D4H.
- Activity create tools (`create_event`, `create_exercise`, `create_incident`) enforce **stricter minimums than the spec**:
  - All three require `startsAt` + `referenceDescription`.
  - Events and exercises **also** require `endsAt`.
  - Incidents leave `endsAt` optional (real callouts are created in-progress and finalized later via `update_incident`).
- When required fields are missing or invalid, mutating tools return a **`needsMoreInfo` response** (`isError: true`, `_meta["mcp-d4h/needsMoreInfo"] = true`) with a human-readable question the LLM naturally turns into a follow-up to the user. The API is **not** called.
- Update tools reject no-op PATCH calls (must supply at least one field to change).
- If `endsAt < startsAt` is supplied, the call is rejected client-side as invalid.

### Unavailable stubs

Three tools are **registered for discoverability** but the underlying D4H v3 API does not expose the necessary endpoint or verb. Calling them returns an "unavailable" response (`isError: true`, `_meta["mcp-d4h/unavailable"] = true`) pointing at the D4H web interface:

- `update_member_qualification` — no PATCH/PUT verb on `/member-qualification-awards`
- `assign_equipment_to_member` — PATCH `/equipment/{id}` rejects every variant of location/member/assignedTo fields (verified by live probe)
- `unassign_equipment_from_member` — same constraint as assign

### Error model

All errors come back as MCP results with `isError: true` and a `text` content block. The server does not crash. See [Error responses](#error-responses) at the bottom of this document for full examples.

### Test record IDs (used in examples below)

Examples use real demo records from the test team:

- Member ID: `20815` (Holly Pulvermacher), `20816` (Neil)
- Equipment ID: `204937` ("Test Command"), `204942` ("Test - Crew Transport")
- Incident ID: `186332` (reference 00079)
- Exercise ID: `175577`
- Team ID: `501` (CA region)

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

## `create_event`

> **Method:** `POST` · **Path:** `/v3/team/{D4H_TEAM_ID}/events` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Create a new routine event (meeting, fundraiser, community engagement). Required: `startsAt`, `endsAt`, `referenceDescription`.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `startsAt` | ISO 8601 string | **yes** | When the event starts. |
| `endsAt` | ISO 8601 string | **yes** | When the event ends. Must be ≥ `startsAt`. |
| `referenceDescription` | string | **yes** | Short title shown in lists. |
| `reference` | string | no | Manual reference code (auto-assigned if omitted). |
| `description` | string \| null | no | Long description (supports HTML). |
| `plan` | string \| null | no | Operational plan (supports HTML). |
| `trackingNumber` | string \| null | no | External tracking number. |
| `shared` | boolean | no | Share across organisation. |
| `fullTeam` | boolean | no | Requires full team attendance. |
| `address` | object | no | Physical address object. |
| `location` | object | no | Geographic location (lat/lon geometry). |
| `locationBookmarkId` | integer | no | Saved bookmark ID. |
| `customFieldValues` | array | no | Array of `{customFieldId, value}` objects. |
| `dry_run` | boolean | no | Default `true`. Set `false` to actually send. |

### Example: dry_run preview (default)

```json
{
  "name": "create_event",
  "arguments": {
    "startsAt": "2026-07-01T18:00:00Z",
    "endsAt": "2026-07-01T20:00:00Z",
    "referenceDescription": "Monthly team meeting"
  }
}
```

Preview returned (no API call):

```json
{
  "dry_run": true,
  "note": "DRY RUN. No request was sent. Re-invoke with `dry_run: false` to actually send the request.",
  "request": {
    "method": "POST",
    "url": "https://api.team-manager.ca.d4h.com/v3/team/501/events",
    "headers": { "Authorization": "Bearer <REDACTED>", "Content-Type": "application/json" },
    "body": {
      "startsAt": "2026-07-01T18:00:00Z",
      "endsAt": "2026-07-01T20:00:00Z",
      "referenceDescription": "Monthly team meeting"
    }
  }
}
```

### Example: missing `endsAt` → needsMoreInfo

```json
{
  "name": "create_event",
  "arguments": { "startsAt": "2026-07-01T18:00:00Z", "referenceDescription": "Monthly meeting" }
}
```

Returns (no API call):

```text
Cannot create this event yet.

I still need:
  • end time (endsAt) — ISO 8601 datetime, e.g. "2026-06-20T16:00:00Z"

What is the end time?
```

### Example: real round-trip (`dry_run: false`)

```json
{
  "name": "create_event",
  "arguments": {
    "startsAt": "2026-07-01T18:00:00Z",
    "endsAt": "2026-07-01T20:00:00Z",
    "referenceDescription": "Monthly team meeting",
    "dry_run": false
  }
}
```

Returns the created event record (`{ id, resourceType: "Event", reference: "...", ... }`).

---

## `create_exercise`

> **Method:** `POST` · **Path:** `/v3/team/{D4H_TEAM_ID}/exercises` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Create a new training exercise. Same shape and required floor as `create_event`: `startsAt`, `endsAt`, `referenceDescription`.

### Input

Same fields as [`create_event`](#create_event).

### Example: dry_run preview

```json
{
  "name": "create_exercise",
  "arguments": {
    "startsAt": "2026-06-20T08:00:00Z",
    "endsAt": "2026-06-20T16:00:00Z",
    "referenceDescription": "Saturday rope rescue training"
  }
}
```

### Example: missing `endsAt` → needsMoreInfo

Same shape as `create_event` missing-endsAt example. Text:

```text
Cannot create this exercise yet.

I still need:
  • end time (endsAt) — ISO 8601 datetime, e.g. "2026-06-20T16:00:00Z"

What is the end time?
```

### Example: real round-trip

```json
{
  "name": "create_exercise",
  "arguments": {
    "startsAt": "2026-06-20T08:00:00Z",
    "endsAt": "2026-06-20T16:00:00Z",
    "referenceDescription": "Saturday rope rescue training",
    "dry_run": false
  }
}
```

---

## `create_incident`

> **Method:** `POST` · **Path:** `/v3/team/{D4H_TEAM_ID}/incidents` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Create a new incident (real response). Required: `startsAt`, `referenceDescription`. **`endsAt` is intentionally optional** — real callouts are typically created while still in-progress and finalized later via [`update_incident`](#update_incident).

### Input

Same fields as [`create_event`](#create_event), except `endsAt` is **optional**.

### Example: dry_run preview (incident in progress, no endsAt)

```json
{
  "name": "create_incident",
  "arguments": {
    "startsAt": "2026-06-20T15:00:00Z",
    "referenceDescription": "Subject overdue — Cypress trail"
  }
}
```

The preview returns successfully (no `needsMoreInfo`) because `endsAt` is not required for incidents.

### Example: missing `referenceDescription` → needsMoreInfo

```json
{
  "name": "create_incident",
  "arguments": { "startsAt": "2026-06-20T15:00:00Z" }
}
```

Returns:

```text
Cannot create this incident yet.

I still need:
  • title (referenceDescription) — short text describing the incident, e.g. "Tuesday rope rescue incident"

What is the title?
```

### Example: real round-trip

```json
{
  "name": "create_incident",
  "arguments": {
    "startsAt": "2026-06-20T15:00:00Z",
    "referenceDescription": "Subject overdue — Cypress trail",
    "dry_run": false
  }
}
```

---

## `update_event`

> **Method:** `PATCH` · **Path:** `/v3/team/{D4H_TEAM_ID}/events/{id}` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Update an existing event. Pass `id` plus at least one field to change. If both `startsAt` and `endsAt` are supplied, `endsAt` must be ≥ `startsAt`.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | **yes** | Event ID (the `id` field from `get_events`). |
| All `create_event` body fields | — | no | All optional in update. At least one required. |
| `dry_run` | boolean | no | Default `true`. |

### Example: dry_run preview

```json
{
  "name": "update_event",
  "arguments": { "id": 12345, "referenceDescription": "Updated title" }
}
```

### Example: no fields to update

```json
{
  "name": "update_event",
  "arguments": { "id": 12345 }
}
```

Returns:

```text
Cannot update this event yet.

Invalid input:
  • (body): no fields to update — provide at least one field to change

Please correct the invalid fields.
```

### Example: real round-trip

```json
{
  "name": "update_event",
  "arguments": { "id": 12345, "endsAt": "2026-07-01T20:30:00Z", "dry_run": false }
}
```

---

## `update_exercise`

> **Method:** `PATCH` · **Path:** `/v3/team/{D4H_TEAM_ID}/exercises/{id}` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Update an existing exercise. Same shape as `update_event`.

### Example: real round-trip (against test exercise `175577`)

```json
{
  "name": "update_exercise",
  "arguments": { "id": 175577, "description": "Updated description", "dry_run": false }
}
```

---

## `update_incident`

> **Method:** `PATCH` · **Path:** `/v3/team/{D4H_TEAM_ID}/incidents/{id}` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Update an existing incident. Same shape as `update_event`. Most common operational use: set `endsAt` on a previously open incident to finalize it.

### Example: close out an open incident (real round-trip against test incident `186332`)

```json
{
  "name": "update_incident",
  "arguments": { "id": 186332, "endsAt": "2026-06-20T21:42:00Z", "dry_run": false }
}
```

---

## `create_equipment`

> **Method:** `POST` · **Path:** `/v3/team/{D4H_TEAM_ID}/equipment` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Create a new equipment item. **To assign the item to a member AT CREATION**, set `location` to `{ resourceType: "Member", id: <memberId> }` — this is the **only** API path that supports member assignment (see [`assign_equipment_to_member`](#assign_equipment_to_member) for the post-creation case).

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `categoryId` | integer | **yes** | Equipment category ID. |
| `kindId` | integer | **yes** | Equipment kind ID. |
| `ref` | string | no | Reference code (auto-generated if omitted). |
| `brandId`, `modelId`, `supplierId`, `supplierRefId`, `fundId` | integer | no | Various ID references. |
| `location` | `{ resourceType, id }` | no | Destination. `resourceType` ∈ `Equipment\|Member\|EquipmentLocation\|Team`. |
| `quantity` | integer | no | Quantity. |
| `notes`, `barcode`, `serial`, `idMarks` | string | no | Free-text fields. |
| `replacementCost`, `weight` | number | no | |
| `dateManufactured`, `datePurchased`, `dateWarranty`, `dateExpires` | ISO 8601 string | no | |
| `isCritical`, `isMonitor` | boolean | no | |
| `dry_run` | boolean | no | Default `true`. |

### Example: dry_run preview (with member assignment at creation)

```json
{
  "name": "create_equipment",
  "arguments": {
    "categoryId": 3216,
    "kindId": 22507,
    "ref": "Test Item 1",
    "location": { "resourceType": "Member", "id": 20816 }
  }
}
```

### Example: real round-trip

```json
{
  "name": "create_equipment",
  "arguments": {
    "categoryId": 3216,
    "kindId": 22507,
    "ref": "Smoke Test",
    "notes": "Created via mcp-d4h smoke test",
    "dry_run": false
  }
}
```

---

## `update_equipment`

> **Method:** `PATCH` · **Path:** `/v3/team/{D4H_TEAM_ID}/equipment/{id}` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Update an equipment item. **Allowed fields are limited by the API**: only `status`, `isCritical`, `isMonitor`, `barcode`, `updateNotes`, `customFieldValues`. `location`/member assignment cannot be changed via this tool (see [`assign_equipment_to_member`](#assign_equipment_to_member)).

### Limitations

- **`status: "RETIRED"` is intentionally NOT supported** — the spec excludes it from the PATCH enum because retirement is a separate workflow with a required reason. To retire an item, use the D4H web interface.
- **Member assignment cannot be updated** — see Blocker 2 in the v0.3.0 release notes.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | **yes** | Equipment ID. |
| `status` | enum | no | One of `OPERATIONAL`, `UNSERVICEABLE`, `LOST`, `WISHLIST`, `INACTIVE`. (NOT `RETIRED`.) |
| `isCritical`, `isMonitor` | boolean | no | |
| `barcode` | string \| null | no | New barcode (null to clear). |
| `updateNotes` | string | no | Notes about this change for the audit log. |
| `customFieldValues` | array | no | Custom field values. |
| `dry_run` | boolean | no | Default `true`. |

### Example: dry_run preview (mark unserviceable)

```json
{
  "name": "update_equipment",
  "arguments": { "id": 204937, "status": "UNSERVICEABLE", "updateNotes": "Pre-trip check found damaged casing" }
}
```

### Example: no fields to update

```json
{ "name": "update_equipment", "arguments": { "id": 204937 } }
```

Returns the same no-op rejection as `update_event`:

```text
Cannot update this equipment yet.

Invalid input:
  • (body): no fields to update — provide at least one field to change
```

### Example: real round-trip (against test item `204937`)

```json
{
  "name": "update_equipment",
  "arguments": { "id": 204937, "isMonitor": true, "updateNotes": "Tracking smoke test", "dry_run": false }
}
```

---

## `assign_equipment_to_member`

> **Status:** ⛔ **UNAVAILABLE** in D4H Team Manager v3 API. Use the D4H web interface to re-assign equipment after creation.

### Why unavailable

Verified by live probe: PATCH `/equipment/{id}` rejects every variant of `location`, `member`, `memberId`, and `assignedTo` with HTTP 400 (`Unrecognized key(s) in object`). The API does not expose a route to mutate equipment assignment after creation.

To assign equipment **at creation**, use [`create_equipment`](#create_equipment) with `location: { resourceType: "Member", id: <memberId> }`.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `equipment_id` | integer | **yes** | Equipment ID. |
| `member_id` | integer | **yes** | Member ID to assign. |
| `dry_run` | boolean | no | Inert — tool returns the unavailable response regardless. |

### Example response

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "assign_equipment_to_member: not supported by the D4H Team Manager v3 API. PATCH /equipment/{id} does not accept location, member, memberId, or assignedTo fields (verified by live probe — all return HTTP 400). To re-assign equipment to a member after creation, use the D4H web interface."
  }],
  "_meta": {
    "mcp-d4h/unavailable": true,
    "mcp-d4h/tool": "assign_equipment_to_member",
    "mcp-d4h/specVersion": "7.0.1"
  }
}
```

---

## `unassign_equipment_from_member`

> **Status:** ⛔ **UNAVAILABLE** in D4H Team Manager v3 API. Use the D4H web interface to clear an equipment assignment.

Same root cause as [`assign_equipment_to_member`](#assign_equipment_to_member) — PATCH `/equipment/{id}` does not accept location-mutating fields.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `equipment_id` | integer | **yes** | Equipment ID. |
| `dry_run` | boolean | no | Inert. |

### Example response

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "unassign_equipment_from_member: not supported by the D4H Team Manager v3 API. PATCH /equipment/{id} does not accept location-mutating fields. To unassign equipment, use the D4H web interface."
  }],
  "_meta": {
    "mcp-d4h/unavailable": true,
    "mcp-d4h/tool": "unassign_equipment_from_member",
    "mcp-d4h/specVersion": "7.0.1"
  }
}
```

---

## `add_member_qualification`

> **Method:** `POST` · **Path:** `/v3/team/{D4H_TEAM_ID}/member-qualification-awards` · ⚠️ **MUTATES** · `dry_run` defaults to `true`

Award a qualification to a member. Required: `memberId`, `qualificationId`, `startsAt`. `endsAt` is optional (null = no expiry).

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memberId` | integer \| `"me"` | **yes** | Member receiving the award. Pass a numeric ID or the literal string `"me"` for the caller's own user. |
| `qualificationId` | integer | **yes** | Qualification definition ID (from `get_qualifications`). |
| `startsAt` | ISO 8601 string | **yes** | When the award starts / was issued. |
| `endsAt` | ISO 8601 string \| null | no | Expiry datetime. `null` = no expiration. |
| `dry_run` | boolean | no | Default `true`. |

### Example: dry_run preview

```json
{
  "name": "add_member_qualification",
  "arguments": {
    "memberId": 20816,
    "qualificationId": 9876,
    "startsAt": "2026-06-20T00:00:00Z",
    "endsAt": "2028-06-20T00:00:00Z"
  }
}
```

### Example: with `memberId: "me"`

```json
{
  "name": "add_member_qualification",
  "arguments": {
    "memberId": "me",
    "qualificationId": 9876,
    "startsAt": "2026-06-20T00:00:00Z"
  }
}
```

### Example: invalid `endsAt < startsAt`

Returns the standard `needsMoreInfo` with the explicit comparison message:

```text
Cannot create this member qualification yet.

Invalid input:
  • endsAt: endsAt (2026-06-19T00:00:00Z) is earlier than startsAt (2026-06-20T00:00:00Z).

Please correct the invalid fields.
```

### Example: real round-trip

```json
{
  "name": "add_member_qualification",
  "arguments": {
    "memberId": 20816,
    "qualificationId": 9876,
    "startsAt": "2026-06-20T00:00:00Z",
    "dry_run": false
  }
}
```

---

## `update_member_qualification`

> **Status:** ⛔ **UNAVAILABLE** in D4H Team Manager v3 API. Use the D4H web interface to edit an existing award.

### Why unavailable

The `/member-qualification-awards` resource exposes only `GET` (list) and `POST` (create). No `PATCH` or `PUT` verb exists — awards are effectively immutable via API.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | **yes** | Award ID. |
| `startsAt` | ISO 8601 string | no | New start. |
| `endsAt` | ISO 8601 string \| null | no | New expiry. |
| `dry_run` | boolean | no | Inert. |

### Example response

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "update_member_qualification: not supported by the D4H Team Manager v3 API (no PATCH/PUT verb is exposed on /member-qualification-awards). Awards cannot be edited via API in the current spec. To modify an existing award, do it in the D4H web interface."
  }],
  "_meta": {
    "mcp-d4h/unavailable": true,
    "mcp-d4h/tool": "update_member_qualification",
    "mcp-d4h/specVersion": "7.0.1"
  }
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

### `needsMoreInfo` (mutating tools, soft refusal)

Returned by mutating tools when required fields are missing or invalid. **Distinguishable** from regular errors by `_meta["mcp-d4h/needsMoreInfo"] = true`. The `text` is phrased as a question so the LLM naturally asks the user for the missing value. The API is NOT called.

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Cannot create this exercise yet.\n\nI still need:\n  • end time (endsAt) — ISO 8601 datetime, e.g. \"2026-06-20T16:00:00Z\"\n\nWhat is the end time?"
  }],
  "_meta": {
    "mcp-d4h/needsMoreInfo": true,
    "mcp-d4h/tool": "create_exercise",
    "mcp-d4h/missing": [
      {
        "field": "endsAt",
        "label": "end time",
        "expected": "ISO 8601 datetime",
        "example": "2026-06-20T16:00:00Z",
        "reason": "required_for_exercise"
      }
    ],
    "mcp-d4h/invalid": []
  }
}
```

### `unavailable` (stub tools)

Returned by the three registered-but-unsupported tools. Distinguishable by `_meta["mcp-d4h/unavailable"] = true`. The API is NOT called.

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "update_member_qualification: not supported by the D4H Team Manager v3 API (no PATCH/PUT verb is exposed on /member-qualification-awards). Awards cannot be edited via API in the current spec. To modify an existing award, do it in the D4H web interface."
  }],
  "_meta": {
    "mcp-d4h/unavailable": true,
    "mcp-d4h/tool": "update_member_qualification",
    "mcp-d4h/specVersion": "7.0.1"
  }
}
```

### `dryRun` (mutating tools, default behaviour)

Not technically an error — `isError` is **not** set — but follows the same `_meta` pattern. Returned by every mutating tool when called without `dry_run: false`. Lets the caller preview the exact HTTP request that would be sent.

```json
{
  "content": [{
    "type": "text",
    "text": "{\n  \"dry_run\": true,\n  \"note\": \"DRY RUN. No request was sent...\",\n  \"request\": { ... }\n}"
  }],
  "_meta": {
    "mcp-d4h/dryRun": true,
    "mcp-d4h/tool": "create_event",
    "mcp-d4h/preview": {
      "method": "POST",
      "url": "https://api.team-manager.ca.d4h.com/v3/team/501/events",
      "headers": { "Authorization": "Bearer <REDACTED>", "Content-Type": "application/json" },
      "body": { "...": "..." }
    }
  }
}
```

See [Troubleshooting](./configuration.md#7-troubleshooting) for what each
HTTP status typically means.
