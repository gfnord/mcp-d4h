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

export const REGION_HOSTS: Record<D4HRegion, string> = {
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
  /** Server returns `-1` for endpoints where the total is not computed (e.g. /search). */
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

/** Boundary type — D4H returns many more fields; we only name the common ones. */
export interface TeamManagerMember {
  id: number;
  name?: string;
  status?: string;
  position?: string;
  ref?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Definition record from `/member-qualifications` — i.e. the qualification
 * CATALOG (per-team templates), NOT per-member awards. For the awards see
 * {@link TeamManagerMemberQualificationAward}.
 */
export interface TeamManagerQualificationDefinition {
  id: number;
  title?: string;
  description?: string;
  cost?: number;
  expiredCost?: number;
  reminderDays?: number;
  expiresMonthsDefault?: number;
  deprecatedBundle?: string | null;
  resourceType?: string;
  owner?: { id: number; resourceType: string };
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Award record from `/member-qualification-awards`. */
export interface TeamManagerMemberQualificationAward {
  id: number;
  owner?: { id: number; resourceType: string };
  member?: { id: number; resourceType: string };
  qualification?: { id: number; resourceType: string; title?: string };
  startsAt?: string;
  endsAt?: string;
  resourceType?: string;
  createdAt?: string;
  updatedAt?: string;
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

/**
 * Boundary type for the three "activity" surfaces — `/incidents`,
 * `/events`, `/exercises`. The shapes are identical; only `resourceType`
 * distinguishes them.
 */
export interface TeamManagerActivity {
  id: number;
  resourceType?: "Incident" | "Event" | "Exercise" | string;
  reference?: string;
  referenceDescription?: string;
  description?: string;
  plan?: string;
  startsAt?: string;
  endsAt?: string;
  address?: string;
  location?: unknown;
  bearing?: number;
  distance?: number;
  night?: boolean;
  fullTeam?: boolean;
  countAttendance?: number;
  countGuests?: number;
  percAttendance?: number;
  published?: boolean;
  approved?: boolean;
  weather?: unknown;
  tags?: unknown;
  owner?: { id: number; resourceType: string };
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TeamManagerAttendance {
  id: number;
  owner?: { id: number; resourceType: string };
  member?: { id: number; resourceType: string };
  activity?: { id: number; resourceType: string };
  role?: { id: number; resourceType: string } | string;
  status?: string;
  duration?: number;
  startsAt?: string;
  endsAt?: string;
  resourceType?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TeamManagerMemberGroup {
  id: number;
  title?: string;
  owner?: { id: number; resourceType: string };
  membershipResourceType?: string;
  required?: boolean;
  deprecatedBundle?: string | null;
  deprecatedShortcode?: string | null;
  resourceType?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TeamManagerTask {
  id: number;
  ref?: string;
  owner?: { id: number; resourceType: string };
  assigned?: unknown;
  status?: string;
  completedAt?: string | null;
  completionType?: string;
  description?: string;
  dueAt?: string;
  targetResource?: unknown;
  createdBy?: unknown;
  resourceType?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Hit from `/search` — heterogeneous; `resourceType` indicates the kind. */
export interface TeamManagerSearchResult {
  id: number;
  title?: string;
  meta?: unknown;
  owner?: { id: number; resourceType: string };
  resourceType?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Write/edit body shapes (POST/PATCH bodies)
// ---------------------------------------------------------------------------

/**
 * Reference to a resource that can contain equipment. Used by
 * `EquipmentCreateBody.location` at creation time.
 *
 * NOTE: PATCH /equipment/{id} does NOT accept `location` — assignment can
 * only be set at creation. Probed live; D4H rejects `location` on PATCH
 * with HTTP 400 `Unrecognized key(s) in object: 'location'`.
 */
export interface EquipmentLocationRef {
  resourceType: "Equipment" | "Member" | "EquipmentLocation" | "Team";
  id: number;
}

export interface EquipmentCreateBody {
  categoryId: number;
  kindId: number;
  ref?: string;
  brandId?: number;
  modelId?: number;
  supplierId?: number;
  supplierRefId?: number;
  fundId?: number;
  location?: EquipmentLocationRef;
  quantity?: number;
  notes?: string;
  barcode?: string;
  serial?: string;
  replacementCost?: number;
  weight?: number;
  dateManufactured?: string;
  datePurchased?: string;
  dateWarranty?: string;
  dateExpires?: string;
  idMarks?: string;
  isCritical?: boolean;
  isMonitor?: boolean;
  expireWarningDays?: number;
  expireWarningUseCount?: number;
  expireWarningUseMinutes?: number;
  expireWarningUseOdometer?: number;
  costPerHour?: number;
  costPerUse?: number;
  costPerDistance?: number;
  odometerReading?: number;
  odometerReadingTotal?: number;
  odometerReadingTotalAllowed?: number;
  usesAllowed?: number;
  minutesAllowed?: number;
}

/**
 * PATCH /equipment/{id} body. Per the spec, the status enum here drops
 * "RETIRED" — equipment cannot be retired via API (it's a separate workflow
 * with a reason). To retire an item, use the D4H web interface.
 */
export interface EquipmentUpdateBody {
  status?: "OPERATIONAL" | "UNSERVICEABLE" | "LOST" | "WISHLIST" | "INACTIVE";
  isCritical?: boolean;
  isMonitor?: boolean;
  barcode?: string | null;
  updateNotes?: string;
  customFieldValues?: unknown[];
}

/** Shared body shape for POST /events, /exercises, /incidents. */
export interface ActivityCreateBody {
  startsAt: string;
  endsAt?: string;
  reference?: string;
  referenceDescription?: string;
  description?: string | null;
  plan?: string | null;
  trackingNumber?: string | null;
  shared?: boolean;
  fullTeam?: boolean;
  address?: unknown;
  location?: unknown;
  locationBookmarkId?: number;
  customFieldValues?: unknown[];
}

/** Shared body shape for PATCH /events/{id}, /exercises/{id}, /incidents/{id}. */
export interface ActivityUpdateBody {
  startsAt?: string;
  endsAt?: string;
  reference?: string;
  referenceDescription?: string;
  description?: string | null;
  plan?: string | null;
  trackingNumber?: string | null;
  shared?: boolean;
  fullTeam?: boolean;
  address?: unknown;
  location?: unknown;
  locationBookmarkId?: number;
  customFieldValues?: unknown[];
}

/**
 * POST /member-qualification-awards body. The `memberId` field is a union —
 * either a numeric member id or the literal string `"me"` for the caller's
 * own user (per the spec).
 */
export interface MemberQualificationAwardCreateBody {
  memberId: number | "me";
  qualificationId: number;
  startsAt: string;
  endsAt?: string | null;
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

  /** GET /v3/team/{teamId}/members/{id} */
  async getMember(id: number): Promise<TeamManagerMember> {
    const endpoint = `/team/${this.teamId}/members/${id}`;
    try {
      const { data } = await this.http.get<TeamManagerMember>(endpoint);
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /**
   * GET /v3/team/{teamId}/member-qualifications
   *
   * Returns the qualification CATALOG (definitions). For per-member awards
   * (who holds what, expiry dates) use {@link listMemberQualificationAwards}.
   */
  async listMemberQualifications(params: {
    page?: number;
    size?: number;
    title?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerQualificationDefinition>> {
    const endpoint = `/team/${this.teamId}/member-qualifications`;
    try {
      const { data } = await this.http.get<
        TeamManagerPage<TeamManagerQualificationDefinition>
      >(endpoint, { params });
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /**
   * GET /v3/team/{teamId}/member-qualification-awards
   *
   * Per-member qualification awards. Supports server-side filter by
   * `member_id` (verified via live probe — `member` and `memberId` both
   * return HTTP 400 with `Unrecognized key`).
   */
  async listMemberQualificationAwards(params: {
    page?: number;
    size?: number;
    member_id?: number;
  } = {}): Promise<TeamManagerPage<TeamManagerMemberQualificationAward>> {
    const endpoint = `/team/${this.teamId}/member-qualification-awards`;
    try {
      const { data } = await this.http.get<
        TeamManagerPage<TeamManagerMemberQualificationAward>
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

  /** GET /v3/team/{teamId}/incidents */
  async listIncidents(params: {
    page?: number;
    size?: number;
    reference?: string;
    before?: string;
    after?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerActivity>> {
    const endpoint = `/team/${this.teamId}/incidents`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerActivity>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/incidents/{id} */
  async getIncident(id: number): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/incidents/${id}`;
    try {
      const { data } = await this.http.get<TeamManagerActivity>(endpoint);
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/events */
  async listEvents(params: {
    page?: number;
    size?: number;
    reference?: string;
    before?: string;
    after?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerActivity>> {
    const endpoint = `/team/${this.teamId}/events`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerActivity>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/exercises */
  async listExercises(params: {
    page?: number;
    size?: number;
    reference?: string;
    before?: string;
    after?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerActivity>> {
    const endpoint = `/team/${this.teamId}/exercises`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerActivity>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/attendance */
  async listAttendance(params: {
    page?: number;
    size?: number;
    member_id?: number;
    status?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerAttendance>> {
    const endpoint = `/team/${this.teamId}/attendance`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerAttendance>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /**
   * GET /v3/team/{teamId}/member-groups
   *
   * Personnel groups (sub-teams). D4H also exposes `/handler-groups` and
   * `/animal-groups` for K9 ops, intentionally not wrapped here.
   */
  async listMemberGroups(params: {
    page?: number;
    size?: number;
    title?: string;
  } = {}): Promise<TeamManagerPage<TeamManagerMemberGroup>> {
    const endpoint = `/team/${this.teamId}/member-groups`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerMemberGroup>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** GET /v3/team/{teamId}/tasks */
  async listTasks(params: {
    page?: number;
    size?: number;
    status?: string;
    assigned_member_id?: number;
  } = {}): Promise<TeamManagerPage<TeamManagerTask>> {
    const endpoint = `/team/${this.teamId}/tasks`;
    try {
      const { data } = await this.http.get<TeamManagerPage<TeamManagerTask>>(
        endpoint,
        { params }
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /**
   * GET /v3/team/{teamId}/search
   *
   * Heterogeneous global search across resource types. `query` is required
   * server-side; absence returns HTTP 400. Note the envelope's `totalSize`
   * is `-1` for this endpoint — the registry doesn't compute it.
   */
  async searchTeam(params: {
    query: string;
    page?: number;
    size?: number;
    resource_type?: string[];
    sort?: string;
    order?: string;
  }): Promise<TeamManagerPage<TeamManagerSearchResult>> {
    const endpoint = `/team/${this.teamId}/search`;
    try {
      const { data } = await this.http.get<
        TeamManagerPage<TeamManagerSearchResult>
      >(endpoint, { params });
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** POST /v3/team/{teamId}/equipment */
  async createEquipment(
    body: EquipmentCreateBody
  ): Promise<TeamManagerEquipment> {
    const endpoint = `/team/${this.teamId}/equipment`;
    try {
      const { data } = await this.http.post<TeamManagerEquipment>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** PATCH /v3/team/{teamId}/equipment/{id} */
  async updateEquipment(
    id: number,
    body: EquipmentUpdateBody
  ): Promise<TeamManagerEquipment> {
    const endpoint = `/team/${this.teamId}/equipment/${id}`;
    try {
      const { data } = await this.http.patch<TeamManagerEquipment>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** POST /v3/team/{teamId}/events */
  async createEvent(body: ActivityCreateBody): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/events`;
    try {
      const { data } = await this.http.post<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** PATCH /v3/team/{teamId}/events/{id} */
  async updateEvent(
    id: number,
    body: ActivityUpdateBody
  ): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/events/${id}`;
    try {
      const { data } = await this.http.patch<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** POST /v3/team/{teamId}/exercises */
  async createExercise(
    body: ActivityCreateBody
  ): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/exercises`;
    try {
      const { data } = await this.http.post<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** PATCH /v3/team/{teamId}/exercises/{id} */
  async updateExercise(
    id: number,
    body: ActivityUpdateBody
  ): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/exercises/${id}`;
    try {
      const { data } = await this.http.patch<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** POST /v3/team/{teamId}/incidents */
  async createIncident(
    body: ActivityCreateBody
  ): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/incidents`;
    try {
      const { data } = await this.http.post<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** PATCH /v3/team/{teamId}/incidents/{id} */
  async updateIncident(
    id: number,
    body: ActivityUpdateBody
  ): Promise<TeamManagerActivity> {
    const endpoint = `/team/${this.teamId}/incidents/${id}`;
    try {
      const { data } = await this.http.patch<TeamManagerActivity>(
        endpoint,
        body
      );
      return data;
    } catch (err) {
      throw wrapAxiosError(err, endpoint);
    }
  }

  /** POST /v3/team/{teamId}/member-qualification-awards */
  async addMemberQualificationAward(
    body: MemberQualificationAwardCreateBody
  ): Promise<TeamManagerMemberQualificationAward> {
    const endpoint = `/team/${this.teamId}/member-qualification-awards`;
    try {
      const { data } = await this.http.post<TeamManagerMemberQualificationAward>(
        endpoint,
        body
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
