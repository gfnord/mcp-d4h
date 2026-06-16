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

// Load .env if present. Failures are silent — production deployments inject
// env vars through the MCP host config.
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
  version: "0.1.0",
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
// Team Manager tools
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
  "get_member_efficiency",
  {
    title: "Check member qualifications and training",
    description:
      "Retrieve qualifications and training awards held by team members " +
      "(Team Manager `/member-qualifications`). Use this to assess a " +
      "specific member's readiness by passing `member_id` (results are " +
      "filtered client-side on `member.id`), or to audit qualifications " +
      "across the team. Optionally filter by qualification title.",
    inputSchema: {
      ...paginationShape,
      member_id: z
        .number()
        .int()
        .optional()
        .describe(
          "Optional numeric member ID. When provided, results are filtered to qualifications owned by that member."
        ),
      title: z
        .string()
        .optional()
        .describe("Filter by qualification title (e.g. 'CPR', 'Swiftwater')."),
    },
  },
  async ({ page, size, member_id, title }): Promise<ToolResult> => {
    try {
      const tm = requireTeamManager();
      const result = await tm.listMemberQualifications({ page, size, title });
      if (member_id !== undefined) {
        const filtered = result.results.filter(
          (q) => q.member?.id === member_id
        );
        return okJson({ ...result, results: filtered, filteredByMemberId: member_id });
      }
      return okJson(result);
    } catch (err) {
      return handleError("get_member_efficiency", err);
    }
  }
);

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
