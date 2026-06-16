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
  version: "0.2.0",
});

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
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
