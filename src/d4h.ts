/**
 * D4H Team Manager API client.
 *
 * Wraps the D4H Team Manager REST API (spec version 7.0.1, URL prefix `/v3`)
 * hosted at `api.team-manager.<region>.d4h.com`.
 *
 * Authentication is `Authorization: Bearer <PAT>` (Personal Access Token).
 * See https://help.d4h.com/article/374-api-quick-start-guide for D4H's
 * own quick-start guide.
 *
 * Credentials, team ID, and region are supplied via environment variables
 * (see .env.example). If credentials are missing the factory returns an
 * empty `D4HClients` object so the MCP layer can surface a precise error
 * back through the protocol rather than crashing at boot.
 */

import axios, { AxiosInstance, AxiosError } from "axios";

// ---------------------------------------------------------------------------
// Region / host resolution
// ---------------------------------------------------------------------------

export type D4HRegion = "US" | "EU" | "CA";

const REGION_HOSTS: Record<D4HRegion, string> = {
  US: "api.team-manager.us.d4h.com",
  EU: "api.team-manager.eu.d4h.com",
  CA: "api.team-manager.ca.d4h.com",
};

export function resolveRegion(input: string | undefined): D4HRegion {
  const value = (input ?? "US").toUpperCase();
  if (value === "US" || value === "EU" || value === "CA") return value;
  throw new Error(
    `Unsupported D4H_REGION "${input}". Expected one of: US, EU, CA.`
  );
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Standard envelope used by Team Manager list endpoints. */
export interface TeamManagerPage<T> {
  results: T[];
  page: number;
  pageSize: number;
  totalSize: number;
}

export interface PaginationOptions {
  page?: number;
  size?: number;
}

/**
 * Normalized error thrown by the client. Carries enough context for the
 * MCP layer to surface a useful message to the LLM without leaking the PAT.
 */
export class D4HApiError extends Error {
  public readonly status: number | undefined;
  public readonly endpoint: string;
  public readonly details: unknown;

  constructor(
    message: string,
    endpoint: string,
    status?: number,
    details?: unknown
  ) {
    super(message);
    this.name = "D4HApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.details = details;
  }
}

function wrapAxiosError(error: unknown, endpoint: string): D4HApiError {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<unknown>;
    const status = axiosErr.response?.status;
    const data = axiosErr.response?.data;
    const summary =
      typeof data === "string"
        ? data
        : data
        ? safeJsonStringify(data, 500)
        : axiosErr.message;
    return new D4HApiError(
      `D4H API ${endpoint} failed${status ? ` (HTTP ${status})` : ""}: ${summary}`,
      endpoint,
      status,
      data ?? undefined
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new D4HApiError(
    `D4H API ${endpoint} failed: ${message}`,
    endpoint
  );
}

function safeJsonStringify(value: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Team Manager client
// ---------------------------------------------------------------------------

export interface TeamManagerClientOptions {
  apiKey: string;
  teamId: string | number;
  region?: D4HRegion;
  timeoutMs?: number;
}

/** Subset of fields commonly returned from Team Manager. */
export interface TeamManagerMember {
  id: number;
  name?: string;
  status?: string;
  position?: string;
  ref?: string;
  email?: string;
  [key: string]: unknown;
}

export interface TeamManagerQualificationAward {
  id: number;
  title?: string;
  owner?: { id: number; resourceType: string };
  member?: { id: number; name?: string };
  awardedAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface TeamManagerEquipment {
  id: number;
  ref?: string;
  status?: string;
  kind?: { id: number; title?: string };
  location?: { id: number; title?: string };
  member?: { id: number; name?: string };
  [key: string]: unknown;
}

export class TeamManagerClient {
  private readonly http: AxiosInstance;
  private readonly teamId: string | number;

  constructor(options: TeamManagerClientOptions) {
    const region = options.region ?? "US";
    const host = REGION_HOSTS[region];
    this.teamId = options.teamId;
    this.http = axios.create({
      baseURL: `https://${host}/v3`,
      timeout: options.timeoutMs ?? 30_000,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
      },
    });
  }

  /** GET /v3/team/{teamId}/members */
  async listMembers(params: {
    page?: number;
    size?: number;
    status?: string;
    search?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerMember>> {
    const endpoint = `/team/${this.teamId}/members`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerMember>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /**
   * GET /v3/team/{teamId}/member-qualifications
   *
   * Returns qualifications/awards held by members of the team. Optionally
   * filter by qualification title. To filter by a specific member, callers
   * can post-filter the results array on `member.id`.
   */
  async listMemberQualifications(params: {
    page?: number;
    size?: number;
    title?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerQualificationAward>> {
    const endpoint = `/team/${this.teamId}/member-qualifications`;
    try {
      const { data } = await this.http.get<
        TeamManagerPage<TeamManagerQualificationAward>
      >(endpoint, { params });
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/equipment */
  async listEquipment(params: {
    page?: number;
    size?: number;
    status?: string;
    ref?: string;
    text?: string;
    location_id?: number;
    member_id?: number;
    kind_id?: number;
    category_id?: number;
  } = {}): Promise<TeamManagerPage<TeamManagerEquipment>> {
    const endpoint = `/team/${this.teamId}/equipment`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerEquipment>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers driven by environment variables
// ---------------------------------------------------------------------------

export interface D4HClients {
  teamManager?: TeamManagerClient;
  region: D4HRegion;
  teamId?: string;
}

export interface EnvLike {
  D4H_TEAM_MANAGER_API_KEY?: string;
  D4H_TEAM_ID?: string;
  D4H_REGION?: string;
  D4H_HTTP_TIMEOUT_MS?: string;
}

/**
 * Build the Team Manager client if credentials are present. Missing
 * credentials do not throw — they leave `teamManager` undefined so the MCP
 * layer can report a precise error when (and only when) a tool is invoked.
 */
export function buildClientsFromEnv(env: EnvLike): D4HClients {
  const region = resolveRegion(env.D4H_REGION);
  const timeoutMs = env.D4H_HTTP_TIMEOUT_MS
    ? Number.parseInt(env.D4H_HTTP_TIMEOUT_MS, 10)
    : undefined;

  const clients: D4HClients = { region };

  if (env.D4H_TEAM_MANAGER_API_KEY && env.D4H_TEAM_ID) {
    clients.teamManager = new TeamManagerClient({
      apiKey: env.D4H_TEAM_MANAGER_API_KEY,
      teamId: env.D4H_TEAM_ID,
      region,
      timeoutMs,
    });
    clients.teamId = env.D4H_TEAM_ID;
  }

  return clients;
}
