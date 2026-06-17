#!/usr/bin/env node
/**
 * mcp-d4h
 *
 * Model Context Protocol server bridging the D4H Team Manager API
 * (spec version 7.0.1, URL prefix `/v3`). Communicates with MCP hosts
 * (Claude Desktop, etc.) over stdio.
 *
 * IMPORTANT: stdout is reserved for the MCP wire protocol. All logging
 * goes to stderr via console.error.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config as loadDotenv } from "dotenv";

import {
  buildClientsFromEnv,
  D4HApiError,
  D4HClients,
  REGION_HOSTS,
  EquipmentCreateBody,
  EquipmentUpdateBody,
  ActivityCreateBody,
  ActivityUpdateBody,
  MemberQualificationAwardCreateBody,
  AttendanceCreateBody,
  AttendanceUpdateBody,
} from "./d4h.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

loadDotenv();

let clients: D4HClients;
try {
  clients = buildClientsFromEnv(process.env);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[mcp-d4h] Configuration error: ${message}`);
  process.exit(1);
}

console.error(
  `[mcp-d4h] Region=${clients.region} ` +
    `TeamManager=${clients.teamManager ? "configured" : "missing"}`
);

const server = new McpServer({
  name: "mcp-d4h",
  version: "0.4.0",
});

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

function okJson(value: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  };
}

function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function handleError(toolName: string, err: unknown): ToolResult {
  if (err instanceof D4HApiError) {
    console.error(`[mcp-d4h] ${toolName} -> ${err.message}`);
    return fail(err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[mcp-d4h] ${toolName} -> Unexpected error: ${message}`);
  return fail(`Unexpected error: ${message}`);
}

function requireTeamManager(): NonNullable<D4HClients["teamManager"]> {
  if (!clients.teamManager) {
    throw new Error(
      "Team Manager client is not configured. Set D4H_TEAM_MANAGER_API_KEY and D4H_TEAM_ID."
    );
  }
  return clients.teamManager;
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const paginationShape = {
  page: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Zero-indexed page number. Default 0."),
  size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page size. Default 20, max 100."),
};

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

server.registerTool(
  "get_members",
  {
    title: "List D4H team members",
    description:
      "Fetch a paginated list of team members from D4H Team Manager, " +
      "including status (OPERATIONAL, NON_OPERATIONAL, OBSERVER, RETIRED), " +
      "role/position, and other personnel metadata. Use this to evaluate " +
      "personnel readiness or look up specific members by name.",
    inputSchema: {
      ...paginationShape,
      status: z
        .enum(["OPERATIONAL", "NON_OPERATIONAL", "OBSERVER", "RETIRED"])
        .optional()
        .describe("Filter by member operational status."),
      search: z
        .string()
        .optional()
        .describe("Free-text search across member name and contact fields."),
    },
  },
  async ({ page, size, status, search }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listMembers({ page, size, status, search });
      return okJson(result);
    } catch (err) {
      return handleError("get_members", err);
    }
  }
);

server.registerTool(
  "get_member",
  {
    title: "Get a single D4H team member by ID",
    description:
      "Fetch the full detail record for one team member from " +
      "`/team/{teamId}/members/{id}`. Returns the same shape as a list entry " +
      "but with the complete field set (custom fields, counters, contact " +
      "info, etc.). Use after `get_members` when you need everything about " +
      "a specific person.",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric member ID (the `id` field from `get_members`)."),
    },
  },
  async ({ id }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.getMember(id);
      return okJson(result);
    } catch (err) {
      return handleError("get_member", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

server.registerTool(
  "get_qualifications",
  {
    title: "List qualification DEFINITIONS (catalog)",
    description:
      "List the team's qualification definitions catalog from " +
      "`/team/{teamId}/member-qualifications` — i.e. the templates / kinds of " +
      "qualifications the team tracks (CPR, Swiftwater, etc.), with their " +
      "default cost, reminder window, and expiry months. This is the CATALOG, " +
      "not per-member awards. For 'who holds what and when does it expire', " +
      "use `get_member_qualification_awards`.",
    inputSchema: {
      ...paginationShape,
      title: z
        .string()
        .optional()
        .describe("Filter by qualification title (e.g. 'CPR', 'Swiftwater')."),
    },
  },
  async ({ page, size, title }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listMemberQualifications({ page, size, title });
      return okJson(result);
    } catch (err) {
      return handleError("get_qualifications", err);
    }
  }
);

server.registerTool(
  "get_member_qualification_awards",
  {
    title: "List per-member qualification awards (readiness data)",
    description:
      "List specific qualification AWARDS held by members from " +
      "`/team/{teamId}/member-qualification-awards`. Each record links a " +
      "member to a qualification with `startsAt` and `endsAt` (expiry). " +
      "Use this for per-person readiness, expiring qualifications, and " +
      "'who is current on X'. Optionally filter to a single member by " +
      "passing `member_id` (server-side filter — verified working).",
    inputSchema: {
      ...paginationShape,
      member_id: z
        .number()
        .int()
        .optional()
        .describe(
          "Filter awards to those held by this member ID (server-side)."
        ),
    },
  },
  async ({ page, size, member_id }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listMemberQualificationAwards({
        page,
        size,
        member_id,
      });
      return okJson(result);
    } catch (err) {
      return handleError("get_member_qualification_awards", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Activities (incidents / events / exercises)
// ---------------------------------------------------------------------------

const activityListShape = {
  ...paginationShape,
  reference: z
    .string()
    .optional()
    .describe(
      "Filter by reference number / free-text reference search (e.g. '0001')."
    ),
  before: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp; only activities starting before this time."
    ),
  after: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp; only activities starting after this time."
    ),
};

server.registerTool(
  "get_incidents",
  {
    title: "List incidents",
    description:
      "List incidents (real responses) from `/team/{teamId}/incidents`. " +
      "Use this to see ongoing or past operational incidents — distinct " +
      "from training exercises and routine events. Pair with `get_incident` " +
      "for full detail on a single record.",
    inputSchema: activityListShape,
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

server.registerTool(
  "get_incident",
  {
    title: "Get a single incident by ID",
    description:
      "Fetch the full detail record for one incident from " +
      "`/team/{teamId}/incidents/{id}`. Use after `get_incidents` when you " +
      "need everything about a specific record (description, location, " +
      "attendance counts, custom fields, etc.).",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric incident ID (the `id` field from `get_incidents`)."),
    },
  },
  async ({ id }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.getIncident(id);
      return okJson(result);
    } catch (err) {
      return handleError("get_incident", err);
    }
  }
);

server.registerTool(
  "get_exercises",
  {
    title: "List training exercises",
    description:
      "List training exercises from `/team/{teamId}/exercises`. " +
      "Exercises are practice / training activities — distinct from real " +
      "incidents and routine events. Same record shape as incidents and " +
      "events; `resourceType` is `Exercise`.",
    inputSchema: activityListShape,
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listExercises(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_exercises", err);
    }
  }
);

server.registerTool(
  "get_events",
  {
    title: "List routine events",
    description:
      "List events from `/team/{teamId}/events`. Events are routine " +
      "activities (meetings, community engagements, fundraisers) — distinct " +
      "from incidents and exercises. Same record shape; `resourceType` is " +
      "`Event`.",
    inputSchema: activityListShape,
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listEvents(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_events", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

server.registerTool(
  "get_attendance",
  {
    title: "List attendance records",
    description:
      "List attendance records from `/team/{teamId}/attendance`. Each " +
      "record links a member to an activity (incident/event/exercise) with " +
      "a status (ATTENDING / ABSENT / ...) and duration. Use this to answer " +
      "'who attended what', participation rates, and individual call-out " +
      "history. Filter by `member_id` to see one person's history.",
    inputSchema: {
      ...paginationShape,
      member_id: z
        .number()
        .int()
        .optional()
        .describe("Filter to attendance records for this member ID."),
      status: z
        .string()
        .optional()
        .describe(
          "Filter by attendance status (e.g. 'ATTENDING', 'ABSENT')."
        ),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listAttendance(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_attendance", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

server.registerTool(
  "get_groups",
  {
    title: "List personnel groups (sub-teams)",
    description:
      "List the team's personnel groups from " +
      "`/team/{teamId}/member-groups` — sub-teams / cells like 'ground team A', " +
      "'rope rescue', 'tech rescue'. Use to see how the team is organized. " +
      "For K9 ops (handlers / animals), D4H exposes separate endpoints not " +
      "wrapped in this server.",
    inputSchema: {
      ...paginationShape,
      title: z
        .string()
        .optional()
        .describe("Filter by group title."),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listMemberGroups(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_groups", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

server.registerTool(
  "get_tasks",
  {
    title: "List tasks",
    description:
      "List tasks from `/team/{teamId}/tasks`. Tasks are TODO items " +
      "(action items, follow-ups, equipment repairs) optionally assigned to " +
      "members and optionally linked to a target resource (e.g. an incident " +
      "or piece of equipment). Use this for outstanding action items and " +
      "completion tracking.",
    inputSchema: {
      ...paginationShape,
      status: z
        .string()
        .optional()
        .describe(
          "Filter by task status (e.g. 'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')."
        ),
      assigned_member_id: z
        .number()
        .int()
        .optional()
        .describe("Filter to tasks assigned to this member ID."),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listTasks(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_tasks", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

server.registerTool(
  "get_equipment",
  {
    title: "List or search D4H equipment inventory",
    description:
      "Search the Team Manager equipment inventory. Returns items with " +
      "operational status (OPERATIONAL, UNSERVICEABLE, RETIRED, LOST, WISHLIST, " +
      "INACTIVE), current location, assigned member, and equipment kind. " +
      "Use this to track gear availability and condition.",
    inputSchema: {
      ...paginationShape,
      status: z
        .enum([
          "OPERATIONAL",
          "UNSERVICEABLE",
          "RETIRED",
          "LOST",
          "WISHLIST",
          "INACTIVE",
        ])
        .optional()
        .describe("Filter by equipment operational status."),
      ref: z
        .string()
        .optional()
        .describe("Filter by exact equipment reference number."),
      text: z
        .string()
        .optional()
        .describe("Free-text search across equipment name/description."),
      location_id: z
        .number()
        .int()
        .optional()
        .describe("Filter by location ID."),
      member_id: z
        .number()
        .int()
        .optional()
        .describe("Filter by assigned member ID."),
      kind_id: z
        .number()
        .int()
        .optional()
        .describe("Filter by equipment kind ID."),
      category_id: z
        .number()
        .int()
        .optional()
        .describe("Filter by equipment category ID."),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listEquipment(params);
      return okJson(result);
    } catch (err) {
      return handleError("get_equipment", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

server.registerTool(
  "search_team",
  {
    title: "Global search across team resources",
    description:
      "Run a heterogeneous global search via `/team/{teamId}/search`. " +
      "Returns mixed results (members, incidents, equipment, etc.) where " +
      "each hit carries a `resourceType` indicating what kind it is. Use " +
      "when the LLM doesn't know which resource type a term refers to (e.g. " +
      "a name might be a person, a vehicle, or an incident reference). " +
      "Note: the envelope's `totalSize` is `-1` for this endpoint — the " +
      "registry doesn't compute it.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("The search query string. Required."),
      ...paginationShape,
      resource_type: z
        .array(z.string())
        .optional()
        .describe(
          "Restrict results to specific resource types (e.g. ['Member', 'Incident'])."
        ),
      sort: z
        .string()
        .optional()
        .describe("Sort field name."),
      order: z
        .string()
        .optional()
        .describe("Sort order: typically 'asc' or 'desc'."),
    },
  },
  async (params): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.searchTeam(params);
      return okJson(result);
    } catch (err) {
      return handleError("search_team", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Write-tool helpers (dry_run preview, validation, needsMoreInfo, unavailable)
// ---------------------------------------------------------------------------

const dryRunShape = {
  dry_run: z
    .boolean()
    .default(true)
    .describe(
      "When true (default), preview the request without sending it. Set false to actually send."
    ),
};

interface MissingField {
  field: string;
  label: string;
  expected: string;
  example: string;
  reason: string;
}

interface InvalidField {
  field: string;
  reason: string;
}

function requireTeamId(): string {
  if (!clients.teamId) {
    throw new Error(
      "Team Manager client is not configured. Set D4H_TEAM_MANAGER_API_KEY and D4H_TEAM_ID."
    );
  }
  return clients.teamId;
}

function previewRequest(
  toolName: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown
): ToolResult {
  const host = REGION_HOSTS[clients.region];
  const url = `https://${host}/v3${path}`;
  const preview = {
    dry_run: true,
    note:
      "DRY RUN. No request was sent. Re-invoke with `dry_run: false` to actually send the request.",
    request: {
      method,
      url,
      headers: {
        Authorization: "Bearer <REDACTED>",
        "Content-Type": "application/json",
      },
      body,
    },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(preview, null, 2) }],
    _meta: {
      "mcp-d4h/dryRun": true,
      "mcp-d4h/tool": toolName,
      "mcp-d4h/preview": preview.request,
    },
  };
}

function needsMoreInfo(
  toolName: string,
  missing: MissingField[],
  invalid: InvalidField[]
): ToolResult {
  const lines: string[] = [];
  const verb = toolName.startsWith("create_")
    ? `create this ${toolName.slice(7).replace(/_/g, " ")}`
    : toolName.startsWith("update_")
    ? `update this ${toolName.slice(7).replace(/_/g, " ")}`
    : toolName.replace(/_/g, " ");
  lines.push(`Cannot ${verb} yet.`);

  if (missing.length > 0) {
    lines.push("");
    lines.push("I still need:");
    for (const m of missing) {
      lines.push(
        `  • ${m.label} (${m.field}) — ${m.expected}, e.g. ${JSON.stringify(m.example)}`
      );
    }
  }

  if (invalid.length > 0) {
    lines.push("");
    lines.push("Invalid input:");
    for (const i of invalid) {
      lines.push(`  • ${i.field}: ${i.reason}`);
    }
  }

  if (missing.length === 1 && invalid.length === 0) {
    lines.push("");
    lines.push(`What is the ${missing[0].label}?`);
  } else if (missing.length > 1 && invalid.length === 0) {
    lines.push("");
    lines.push(
      `Please provide ${missing.map((m) => m.label).join(", ")}.`
    );
  } else if (invalid.length > 0 && missing.length === 0) {
    lines.push("");
    lines.push("Please correct the invalid fields.");
  } else if (invalid.length > 0 && missing.length > 0) {
    lines.push("");
    lines.push(
      `Please correct the invalid fields and supply the missing ones (${missing
        .map((m) => m.label)
        .join(", ")}).`
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
    _meta: {
      "mcp-d4h/needsMoreInfo": true,
      "mcp-d4h/tool": toolName,
      "mcp-d4h/missing": missing,
      "mcp-d4h/invalid": invalid,
    },
  };
}

function unavailable(toolName: string, reason: string): ToolResult {
  return {
    content: [{ type: "text", text: `${toolName}: ${reason}` }],
    isError: true,
    _meta: {
      "mcp-d4h/unavailable": true,
      "mcp-d4h/tool": toolName,
      "mcp-d4h/specVersion": "7.0.1",
    },
  };
}

/** Broad ISO 8601 datetime check; lets the API do strict parsing. */
function isIsoDateTime(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)
  );
}

interface ActivityArgs {
  startsAt?: string;
  endsAt?: string;
  referenceDescription?: string;
}

type ValidationResult =
  | { ok: true }
  | { ok: false; missing: MissingField[]; invalid: InvalidField[] };

function validateActivityMinimums(
  args: ActivityArgs,
  opts: { kind: "event" | "exercise" | "incident"; requireEndsAt: boolean }
): ValidationResult {
  const missing: MissingField[] = [];
  const invalid: InvalidField[] = [];

  if (!args.startsAt) {
    missing.push({
      field: "startsAt",
      label: "start time",
      expected: "ISO 8601 datetime",
      example: "2026-06-20T08:00:00Z",
      reason: `required_for_${opts.kind}`,
    });
  } else if (!isIsoDateTime(args.startsAt)) {
    invalid.push({
      field: "startsAt",
      reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.startsAt)})`,
    });
  }

  if (!args.referenceDescription) {
    missing.push({
      field: "referenceDescription",
      label: "title",
      expected: `short text describing the ${opts.kind}`,
      example: `Tuesday rope rescue ${opts.kind}`,
      reason: `required_for_${opts.kind}`,
    });
  }

  if (opts.requireEndsAt) {
    if (!args.endsAt) {
      missing.push({
        field: "endsAt",
        label: "end time",
        expected: "ISO 8601 datetime",
        example: "2026-06-20T16:00:00Z",
        reason: `required_for_${opts.kind}`,
      });
    } else if (!isIsoDateTime(args.endsAt)) {
      invalid.push({
        field: "endsAt",
        reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.endsAt)})`,
      });
    }
  } else if (args.endsAt && !isIsoDateTime(args.endsAt)) {
    invalid.push({
      field: "endsAt",
      reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.endsAt)})`,
    });
  }

  if (
    args.startsAt &&
    args.endsAt &&
    isIsoDateTime(args.startsAt) &&
    isIsoDateTime(args.endsAt) &&
    new Date(args.endsAt) < new Date(args.startsAt)
  ) {
    invalid.push({
      field: "endsAt",
      reason: `endsAt (${args.endsAt}) is earlier than startsAt (${args.startsAt}). End must be at or after start.`,
    });
  }

  if (missing.length === 0 && invalid.length === 0) return { ok: true };
  return { ok: false, missing, invalid };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in o) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

function rejectIfNoUpdateFields(
  args: Record<string, unknown>,
  toolName: string
): ToolResult | null {
  const has = Object.keys(args).some((k) => args[k] !== undefined);
  if (!has) {
    return needsMoreInfo(toolName, [], [
      {
        field: "(body)",
        reason: "no fields to update — provide at least one field to change",
      },
    ]);
  }
  return null;
}

const activityCreateShape = {
  startsAt: z
    .string()
    .describe(
      "ISO 8601 datetime when the activity starts. e.g. \"2026-06-20T08:00:00Z\""
    ),
  endsAt: z
    .string()
    .optional()
    .describe(
      "ISO 8601 datetime when the activity ends. Required for events and exercises; optional for incidents (set later via update_incident)."
    ),
  referenceDescription: z
    .string()
    .describe(
      "Short title shown in lists. e.g. \"Tuesday rope rescue exercise\""
    ),
  reference: z
    .string()
    .optional()
    .describe("Manual reference code. D4H auto-assigns one if omitted."),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("Long description. Supports HTML."),
  plan: z
    .string()
    .nullable()
    .optional()
    .describe("Operational plan. Supports HTML."),
  trackingNumber: z
    .string()
    .nullable()
    .optional()
    .describe("External tracking number."),
  shared: z
    .boolean()
    .optional()
    .describe("Whether the activity is shared across the organisation."),
  fullTeam: z
    .boolean()
    .optional()
    .describe("Whether the activity requires the full team."),
  address: z
    .object({
      street: z.string().max(100).optional(),
      town: z
        .string()
        .max(100)
        .optional()
        .describe("City or town name. D4H's field is named `town`."),
      region: z
        .string()
        .max(100)
        .optional()
        .describe("Province, state, or region. D4H's field is named `region`."),
      postcode: z.string().max(100).optional(),
      country: z.string().optional(),
    })
    .optional()
    .describe(
      "Postal address. Use `town` for city and `region` for province/state. All fields optional within the object."
    ),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional()
    .describe(
      "Geographic coordinates as flat lat/lon (NOT GeoJSON — D4H returns GeoJSON on read but the v3 API spec requires flat lat/lon on write)."
    ),
  locationBookmarkId: z
    .number()
    .int()
    .optional()
    .describe("Numeric ID of a saved location bookmark."),
  customFieldValues: z
    .array(z.unknown())
    .optional()
    .describe("Array of {customFieldId, value} objects."),
};

const activityUpdateShape = {
  startsAt: z.string().optional().describe("ISO 8601 datetime."),
  endsAt: z.string().optional().describe("ISO 8601 datetime."),
  referenceDescription: z.string().optional().describe("Short title."),
  reference: z.string().optional().describe("Manual reference code."),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("Long description. Supports HTML."),
  plan: z
    .string()
    .nullable()
    .optional()
    .describe("Operational plan. Supports HTML."),
  trackingNumber: z
    .string()
    .nullable()
    .optional()
    .describe("External tracking number."),
  shared: z.boolean().optional().describe("Shared across organisation."),
  fullTeam: z.boolean().optional().describe("Requires full team."),
  address: z
    .object({
      street: z.string().max(100).optional(),
      town: z.string().max(100).optional().describe("City or town."),
      region: z.string().max(100).optional().describe("Province/state/region."),
      postcode: z.string().max(100).optional(),
      country: z.string().optional(),
    })
    .optional()
    .describe(
      "Postal address. Use `town` for city and `region` for province/state."
    ),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional()
    .describe(
      "Geographic coordinates as flat lat/lon (NOT GeoJSON — D4H returns GeoJSON on read but the v3 API spec requires flat lat/lon on write)."
    ),
  locationBookmarkId: z
    .number()
    .int()
    .optional()
    .describe("Saved bookmark ID."),
  customFieldValues: z
    .array(z.unknown())
    .optional()
    .describe("Custom field values."),
};

// ---------------------------------------------------------------------------
// Activities — create
// ---------------------------------------------------------------------------

server.registerTool(
  "create_event",
  {
    title: "Create a D4H event (MUTATES)",
    description:
      "Create a routine event (meeting, fundraiser, community engagement) via POST /events. " +
      "MUTATES data. dry_run defaults to true; review the preview before re-invoking with dry_run: false. " +
      "Required: startsAt, endsAt, referenceDescription.",
    inputSchema: { ...activityCreateShape, ...dryRunShape },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const v = validateActivityMinimums(args, {
        kind: "event",
        requireEndsAt: true,
      });
      if (!v.ok) return needsMoreInfo("create_event", v.missing, v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityCreateBody;
      const path = `/team/${teamId}/events`;

      if (dry_run !== false) return previewRequest("create_event", "POST", path, body);

      const result = await tm.createEvent(body);
      return okJson(result);
    } catch (err) {
      return handleError("create_event", err);
    }
  }
);

server.registerTool(
  "create_exercise",
  {
    title: "Create a D4H training exercise (MUTATES)",
    description:
      "Create a training exercise via POST /exercises. MUTATES data. dry_run defaults to true; " +
      "review the preview before re-invoking with dry_run: false. " +
      "Required: startsAt, endsAt, referenceDescription.",
    inputSchema: { ...activityCreateShape, ...dryRunShape },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const v = validateActivityMinimums(args, {
        kind: "exercise",
        requireEndsAt: true,
      });
      if (!v.ok) return needsMoreInfo("create_exercise", v.missing, v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityCreateBody;
      const path = `/team/${teamId}/exercises`;

      if (dry_run !== false) return previewRequest("create_exercise", "POST", path, body);

      const result = await tm.createExercise(body);
      return okJson(result);
    } catch (err) {
      return handleError("create_exercise", err);
    }
  }
);

server.registerTool(
  "create_incident",
  {
    title: "Create a D4H incident (MUTATES)",
    description:
      "Create an incident via POST /incidents. MUTATES data. dry_run defaults to true; " +
      "review the preview before re-invoking with dry_run: false. " +
      "Required: startsAt, referenceDescription. " +
      "endsAt is INTENTIONALLY optional — real callouts are created in-progress and finalized later via update_incident.",
    inputSchema: { ...activityCreateShape, ...dryRunShape },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const v = validateActivityMinimums(args, {
        kind: "incident",
        requireEndsAt: false,
      });
      if (!v.ok) return needsMoreInfo("create_incident", v.missing, v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityCreateBody;
      const path = `/team/${teamId}/incidents`;

      if (dry_run !== false) return previewRequest("create_incident", "POST", path, body);

      const result = await tm.createIncident(body);
      return okJson(result);
    } catch (err) {
      return handleError("create_incident", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Activities — update
// ---------------------------------------------------------------------------

server.registerTool(
  "update_event",
  {
    title: "Update a D4H event (MUTATES)",
    description:
      "Update an existing event via PATCH /events/{id}. MUTATES data. dry_run defaults to true. " +
      "Provide the event id plus at least one field to change. If endsAt and startsAt are both provided, endsAt must be >= startsAt.",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric event ID (the `id` field from get_events)."),
      ...activityUpdateShape,
      ...dryRunShape,
    },
  },
  async ({ id, dry_run, ...args }): Promise<ToolResult> => {
    try {
      const reject = rejectIfNoUpdateFields(args, "update_event");
      if (reject) return reject;

      const v = validateActivityMinimums(args, {
        kind: "event",
        requireEndsAt: false,
      });
      if (!v.ok && v.invalid.length > 0) return needsMoreInfo("update_event", [], v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityUpdateBody;
      const path = `/team/${teamId}/events/${id}`;

      if (dry_run !== false) return previewRequest("update_event", "PATCH", path, body);

      const result = await tm.updateEvent(id, body);
      return okJson(result);
    } catch (err) {
      return handleError("update_event", err);
    }
  }
);

server.registerTool(
  "update_exercise",
  {
    title: "Update a D4H exercise (MUTATES)",
    description:
      "Update an existing exercise via PATCH /exercises/{id}. MUTATES data. dry_run defaults to true. " +
      "Provide the exercise id plus at least one field to change.",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric exercise ID (the `id` field from get_exercises)."),
      ...activityUpdateShape,
      ...dryRunShape,
    },
  },
  async ({ id, dry_run, ...args }): Promise<ToolResult> => {
    try {
      const reject = rejectIfNoUpdateFields(args, "update_exercise");
      if (reject) return reject;

      const v = validateActivityMinimums(args, {
        kind: "exercise",
        requireEndsAt: false,
      });
      if (!v.ok && v.invalid.length > 0) return needsMoreInfo("update_exercise", [], v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityUpdateBody;
      const path = `/team/${teamId}/exercises/${id}`;

      if (dry_run !== false) return previewRequest("update_exercise", "PATCH", path, body);

      const result = await tm.updateExercise(id, body);
      return okJson(result);
    } catch (err) {
      return handleError("update_exercise", err);
    }
  }
);

server.registerTool(
  "update_incident",
  {
    title: "Update a D4H incident (MUTATES)",
    description:
      "Update an existing incident via PATCH /incidents/{id}. MUTATES data. dry_run defaults to true. " +
      "Common use: set endsAt on a previously open incident to close it out. Provide the incident id plus at least one field to change.",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric incident ID (the `id` field from get_incidents)."),
      ...activityUpdateShape,
      ...dryRunShape,
    },
  },
  async ({ id, dry_run, ...args }): Promise<ToolResult> => {
    try {
      const reject = rejectIfNoUpdateFields(args, "update_incident");
      if (reject) return reject;

      const v = validateActivityMinimums(args, {
        kind: "incident",
        requireEndsAt: false,
      });
      if (!v.ok && v.invalid.length > 0) return needsMoreInfo("update_incident", [], v.invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as ActivityUpdateBody;
      const path = `/team/${teamId}/incidents/${id}`;

      if (dry_run !== false) return previewRequest("update_incident", "PATCH", path, body);

      const result = await tm.updateIncident(id, body);
      return okJson(result);
    } catch (err) {
      return handleError("update_incident", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Equipment — create / update
// ---------------------------------------------------------------------------

server.registerTool(
  "create_equipment",
  {
    title: "Create a D4H equipment item (MUTATES)",
    description:
      "Create a new equipment item via POST /equipment. MUTATES data. dry_run defaults to true. " +
      "Required: categoryId, kindId. To assign the item to a member AT CREATION, set " +
      "`location` to { resourceType: \"Member\", id: <memberId> }. After creation, equipment cannot be " +
      "re-assigned via API (see assign_equipment_to_member).",
    inputSchema: {
      categoryId: z
        .number()
        .int()
        .describe("Numeric equipment category ID. Required."),
      kindId: z
        .number()
        .int()
        .describe("Numeric equipment kind ID. Required."),
      ref: z
        .string()
        .optional()
        .describe("Reference code. Auto-generated if omitted."),
      brandId: z.number().int().optional().describe("Brand ID."),
      modelId: z.number().int().optional().describe("Model ID."),
      supplierId: z.number().int().optional().describe("Supplier ID."),
      supplierRefId: z.number().int().optional().describe("Supplier reference ID."),
      fundId: z.number().int().optional().describe("Funding source ID."),
      location: z
        .object({
          resourceType: z.enum([
            "Equipment",
            "Member",
            "EquipmentLocation",
            "Team",
          ]),
          id: z.number().int(),
        })
        .optional()
        .describe(
          "Where this equipment is stored or who holds it. For member assignment at creation, use { resourceType: \"Member\", id: <memberId> }."
        ),
      quantity: z.number().int().optional().describe("Quantity."),
      notes: z.string().optional().describe("Free-text notes."),
      barcode: z.string().optional().describe("Barcode."),
      serial: z.string().optional().describe("Serial number."),
      replacementCost: z.number().optional().describe("Replacement cost."),
      weight: z.number().optional().describe("Weight."),
      dateManufactured: z
        .string()
        .optional()
        .describe("ISO 8601 date when manufactured."),
      datePurchased: z
        .string()
        .optional()
        .describe("ISO 8601 date when purchased."),
      dateWarranty: z
        .string()
        .optional()
        .describe("ISO 8601 warranty expiry date."),
      dateExpires: z
        .string()
        .optional()
        .describe("ISO 8601 item expiry date."),
      idMarks: z.string().optional().describe("Identifying marks."),
      isCritical: z
        .boolean()
        .optional()
        .describe("Flag as critical equipment."),
      isMonitor: z
        .boolean()
        .optional()
        .describe("Flag as monitored equipment."),
      ...dryRunShape,
    },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as EquipmentCreateBody;
      const path = `/team/${teamId}/equipment`;

      if (dry_run !== false) return previewRequest("create_equipment", "POST", path, body);

      const result = await tm.createEquipment(body);
      return okJson(result);
    } catch (err) {
      return handleError("create_equipment", err);
    }
  }
);

server.registerTool(
  "update_equipment",
  {
    title: "Update a D4H equipment item (MUTATES)",
    description:
      "Update an equipment item via PATCH /equipment/{id}. MUTATES data. dry_run defaults to true. " +
      "Only allowed fields: status, isCritical, isMonitor, barcode, updateNotes, customFieldValues. " +
      "NOTE: `RETIRED` is INTENTIONALLY excluded from the status enum — equipment cannot be retired via API; use the D4H web interface. " +
      "Likewise, member assignment cannot be changed via this endpoint (see assign_equipment_to_member).",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric equipment ID (the `id` field from get_equipment)."),
      status: z
        .enum(["OPERATIONAL", "UNSERVICEABLE", "LOST", "WISHLIST", "INACTIVE"])
        .optional()
        .describe(
          "New operational status. RETIRED is NOT supported — use the D4H web interface to retire items."
        ),
      isCritical: z
        .boolean()
        .optional()
        .describe("Flag as critical equipment."),
      isMonitor: z
        .boolean()
        .optional()
        .describe("Flag as monitored equipment."),
      barcode: z
        .string()
        .nullable()
        .optional()
        .describe("New barcode value (null to clear)."),
      updateNotes: z
        .string()
        .optional()
        .describe("Notes about this change for the audit log."),
      customFieldValues: z
        .array(z.unknown())
        .optional()
        .describe("Custom field values to set."),
      ...dryRunShape,
    },
  },
  async ({ id, dry_run, ...args }): Promise<ToolResult> => {
    try {
      const reject = rejectIfNoUpdateFields(args, "update_equipment");
      if (reject) return reject;

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as EquipmentUpdateBody;
      const path = `/team/${teamId}/equipment/${id}`;

      if (dry_run !== false) return previewRequest("update_equipment", "PATCH", path, body);

      const result = await tm.updateEquipment(id, body);
      return okJson(result);
    } catch (err) {
      return handleError("update_equipment", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Equipment ↔ member assignment — UNAVAILABLE in API v3 (registered as stubs)
// ---------------------------------------------------------------------------

server.registerTool(
  "assign_equipment_to_member",
  {
    title: "Assign equipment to a member (UNAVAILABLE)",
    description:
      "Assign an existing equipment item to a member. REGISTERED AS UNAVAILABLE because the D4H Team Manager v3 API does not expose this operation: PATCH /equipment/{id} rejects every variant of location/member/assignedTo with HTTP 400 (verified via live probe). To assign equipment to a member after creation, use the D4H web interface. To assign AT CREATION, use create_equipment with `location: { resourceType: \"Member\", id }`.",
    inputSchema: {
      equipment_id: z
        .number()
        .int()
        .describe("Numeric equipment ID."),
      member_id: z
        .number()
        .int()
        .describe("Numeric member ID to assign the equipment to."),
      ...dryRunShape,
    },
  },
  async (): Promise<ToolResult> => {
    return unavailable(
      "assign_equipment_to_member",
      "not supported by the D4H Team Manager v3 API. PATCH /equipment/{id} does not accept location, member, memberId, or assignedTo fields (verified by live probe — all return HTTP 400). To re-assign equipment to a member after creation, use the D4H web interface."
    );
  }
);

server.registerTool(
  "unassign_equipment_from_member",
  {
    title: "Unassign equipment from a member (UNAVAILABLE)",
    description:
      "Clear a member assignment on an existing equipment item. REGISTERED AS UNAVAILABLE for the same reason as assign_equipment_to_member: PATCH /equipment/{id} does not accept location-mutating fields. To unassign equipment from a member, use the D4H web interface.",
    inputSchema: {
      equipment_id: z
        .number()
        .int()
        .describe("Numeric equipment ID."),
      ...dryRunShape,
    },
  },
  async (): Promise<ToolResult> => {
    return unavailable(
      "unassign_equipment_from_member",
      "not supported by the D4H Team Manager v3 API. PATCH /equipment/{id} does not accept location-mutating fields. To unassign equipment, use the D4H web interface."
    );
  }
);

// ---------------------------------------------------------------------------
// Member qualifications — create (add award) + unavailable update stub
// ---------------------------------------------------------------------------

server.registerTool(
  "add_member_qualification",
  {
    title: "Award a qualification to a member (MUTATES)",
    description:
      "Create a new qualification award via POST /member-qualification-awards. MUTATES data. dry_run defaults to true. " +
      "Required: memberId (numeric OR the literal string \"me\"), qualificationId, startsAt. endsAt is optional (null = no expiry).",
    inputSchema: {
      memberId: z
        .union([z.number().int(), z.literal("me")])
        .describe(
          "Member ID receiving the award. Use a numeric ID or the literal string \"me\" for the caller's own user."
        ),
      qualificationId: z
        .number()
        .int()
        .describe(
          "Numeric ID of the qualification definition (from get_qualifications)."
        ),
      startsAt: z
        .string()
        .describe("ISO 8601 datetime when the award starts/was issued."),
      endsAt: z
        .string()
        .nullable()
        .optional()
        .describe(
          "ISO 8601 expiry datetime, or null for no expiration. Optional."
        ),
      ...dryRunShape,
    },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const invalid: InvalidField[] = [];
      if (!isIsoDateTime(args.startsAt)) {
        invalid.push({
          field: "startsAt",
          reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.startsAt)})`,
        });
      }
      if (args.endsAt && !isIsoDateTime(args.endsAt)) {
        invalid.push({
          field: "endsAt",
          reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.endsAt)})`,
        });
      }
      if (
        args.startsAt &&
        args.endsAt &&
        isIsoDateTime(args.startsAt) &&
        isIsoDateTime(args.endsAt) &&
        new Date(args.endsAt) < new Date(args.startsAt)
      ) {
        invalid.push({
          field: "endsAt",
          reason: `endsAt (${args.endsAt}) is earlier than startsAt (${args.startsAt}).`,
        });
      }
      if (invalid.length > 0) return needsMoreInfo("add_member_qualification", [], invalid);

      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const body = stripUndefined(args) as MemberQualificationAwardCreateBody;
      const path = `/team/${teamId}/member-qualification-awards`;

      if (dry_run !== false) return previewRequest("add_member_qualification", "POST", path, body);

      const result = await tm.addMemberQualificationAward(body);
      return okJson(result);
    } catch (err) {
      return handleError("add_member_qualification", err);
    }
  }
);

server.registerTool(
  "update_member_qualification",
  {
    title: "Update a qualification award (UNAVAILABLE)",
    description:
      "Edit an existing qualification award. REGISTERED AS UNAVAILABLE because the D4H Team Manager v3 API does not expose a PATCH or PUT verb on /member-qualification-awards — only GET and POST exist. To modify an existing award, use the D4H web interface.",
    inputSchema: {
      id: z
        .number()
        .int()
        .describe("Numeric award ID (from get_member_qualification_awards)."),
      startsAt: z.string().optional().describe("New start ISO 8601 datetime."),
      endsAt: z
        .string()
        .nullable()
        .optional()
        .describe("New end ISO 8601 datetime, or null for no expiry."),
      ...dryRunShape,
    },
  },
  async (): Promise<ToolResult> => {
    return unavailable(
      "update_member_qualification",
      "not supported by the D4H Team Manager v3 API (no PATCH/PUT verb is exposed on /member-qualification-awards). Awards cannot be edited via API in the current spec. To modify an existing award, do it in the D4H web interface."
    );
  }
);

// ---------------------------------------------------------------------------
// Attendance — manage (add / update / remove)
// ---------------------------------------------------------------------------

server.registerTool(
  "manage_attendance",
  {
    title: "Add, update, or remove attendance (MUTATES)",
    description:
      "Manage attendance records via POST/PATCH/DELETE on /attendance. " +
      "action: \"add\" adds a member to an activity (POST). \"update\" edits an existing attendance record (PATCH). " +
      "\"remove\" deletes an attendance record (DELETE). " +
      "dry_run defaults to true. The remove action is the only DELETE in this server — attendance is an edge record " +
      "(member↔activity), not an entity; removing it edits the activity's roster without deleting the member or activity.",
    inputSchema: {
      action: z
        .enum(["add", "update", "remove"])
        .describe("Which attendance operation to perform."),
      id: z
        .number()
        .int()
        .optional()
        .describe(
          "Existing attendance record ID. Required for update and remove."
        ),
      memberId: z
        .number()
        .int()
        .optional()
        .describe("Member ID to mark attendance for. Required for add."),
      activityId: z
        .number()
        .int()
        .optional()
        .describe("Activity (incident/event/exercise) ID. Required for add."),
      status: z
        .enum(["ABSENT", "ATTENDING", "REQUESTED"])
        .optional()
        .describe(
          'Attendance status. Optional — defaults to "ATTENDING" on add. Allowed: ABSENT, ATTENDING, REQUESTED.'
        ),
      startsAt: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime when attendance starts. Required for add; optional for update."
        ),
      endsAt: z
        .string()
        .optional()
        .describe(
          "ISO 8601 datetime when attendance ends. Required for add; optional for update."
        ),
      roleId: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("Role ID assigned for this attendance. Optional."),
      ...dryRunShape,
    },
  },
  async ({ dry_run, ...args }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const teamId = requireTeamId();
      const action = args.action;
      const invalid: InvalidField[] = [];

      if (action === "add") {
        if (args.memberId === undefined)
          invalid.push({ field: "memberId", reason: "required for add" });
        if (args.activityId === undefined)
          invalid.push({ field: "activityId", reason: "required for add" });
        if (!args.startsAt)
          invalid.push({ field: "startsAt", reason: "required for add" });
        if (!args.endsAt)
          invalid.push({ field: "endsAt", reason: "required for add" });
      } else if (action === "update" || action === "remove") {
        if (args.id === undefined)
          invalid.push({ field: "id", reason: `required for ${action}` });
      }

      if (args.startsAt && !isIsoDateTime(args.startsAt)) {
        invalid.push({
          field: "startsAt",
          reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.startsAt)})`,
        });
      }
      if (args.endsAt && !isIsoDateTime(args.endsAt)) {
        invalid.push({
          field: "endsAt",
          reason: `not a valid ISO 8601 datetime (got ${JSON.stringify(args.endsAt)})`,
        });
      }

      if (invalid.length > 0)
        return needsMoreInfo("manage_attendance", [], invalid);

      if (action === "remove") {
        const path = `/team/${teamId}/attendance/${args.id}`;
        if (dry_run !== false)
          return previewRequest("manage_attendance", "DELETE", path, null);
        await tm.removeAttendance(args.id!);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                deleted: true,
                id: args.id,
                note: "Attendance record removed.",
              }),
            },
          ],
        };
      }

      if (action === "update") {
        const updateFields: Record<string, unknown> = {};
        if (args.status !== undefined) updateFields.status = args.status;
        if (args.roleId !== undefined) updateFields.roleId = args.roleId;
        if (args.startsAt !== undefined) updateFields.startsAt = args.startsAt;
        if (args.endsAt !== undefined) updateFields.endsAt = args.endsAt;

        const rejection = rejectIfNoUpdateFields(
          updateFields,
          "manage_attendance"
        );
        if (rejection) return rejection;

        const path = `/team/${teamId}/attendance/${args.id}`;
        const body = stripUndefined(
          updateFields
        ) as AttendanceUpdateBody;

        if (dry_run !== false)
          return previewRequest("manage_attendance", "PATCH", path, body);

        const result = await tm.updateAttendance(args.id!, body);
        return okJson(result);
      }

      const body = stripUndefined({
        memberId: args.memberId,
        activityId: args.activityId,
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        status: args.status,
        roleId: args.roleId,
      }) as AttendanceCreateBody;

      const path = `/team/${teamId}/attendance`;

      if (dry_run !== false)
        return previewRequest("manage_attendance", "POST", path, body);

      const result = await tm.createAttendance(body);
      return okJson(result);
    } catch (err) {
      return handleError("manage_attendance", err);
    }
  }
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-d4h] MCP server ready on stdio.");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[mcp-d4h] Fatal error: ${message}`);
  process.exit(1);
});
