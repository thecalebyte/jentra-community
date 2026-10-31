import {
  ApiErrorSchema,
  CommandReceiptSchema,
  type CommandEnvelope,
  type CommandReceipt,
  type HarnessDescriptorContract,
  type AgentConnectionRequestContract,
  type AgentSetupProfile,
  type HarnessInventory,
  type ProjectActivityPreviewRequestContract,
  type ProjectAgentConnectionRequestContract,
  type ProjectCreateRequestContract,
  type ProjectJourneyStartRequestContract,
  type ProjectStartRequestContract,
  type QuickStartAnswersContract,
  type CapabilityBindingMutation,
  type CredentialReferenceMutation,
  type DeliveryBoundaryMutation,
  type ProjectAutonomyPolicyMutation,
  type SourceConnectionMutation,
  JourneyCapsuleV1Schema,
  type JourneyCapsuleV1,
} from "@jentra/contracts";
import type { ApiError } from "@jentra/contracts";
export type { ExternalEffectReceipt } from "@jentra/contracts";

export type AdaptivePlanningRequest = Record<string, unknown> & {
  journeyId: string;
  worldId?: string;
};

export type AdaptiveRunAdmissionRequest = Record<string, unknown> & {
  admissionId: string;
  runId: string;
  planId: string;
  journeyId: string;
  worldId: string;
};

export interface AdaptiveConcurrencySummary {
  logicalParticipants: number;
  admittedAgents: number;
  queuedAgents: number;
  activeAgents: number;
  modelRequestsInFlight: number;
  byPool: Record<string, number>;
}

export interface RuntimeHostDiagnostic {
  hostId: string;
  adapter: string;
  kind?: "LOCAL" | "IDE" | "HARNESS" | "CLOUD";
  ownership?: "USER" | "ORGANIZATION" | "JENTRA";
  capabilities: string[];
  missingCapabilities: string[];
  activeRuns: number;
  reservedRuns: number;
  maxConcurrent: number;
  heartbeatAt: string;
  supportsCheckpoint?: boolean;
  supportsManagedTopology?: boolean;
  costClass?: "USER_PAID" | "JENTRA_PAID" | "NO_METERED_COST";
  nativeTools?: RuntimeNativeToolManifest;
  nativeToolNegotiation?: NativeToolNegotiation;
  status:
    | "READY"
    | "STALE"
    | "FULL"
    | "ADAPTER_MISMATCH"
    | "MISSING_CAPABILITIES"
    | "TOOL_NEGOTIATION_FAILED";
  eligible: boolean;
  reason: string;
}

export type NativeToolId =
  | "terminal"
  | "filesystem"
  | "git"
  | "browser"
  | "http"
  | "mcp"
  | "database"
  | "communication"
  | "deployment"
  | "desktop"
  | "mobile"
  | "simulator";
export interface RuntimeNativeToolManifest {
  vocabulary: "JENTRA_NATIVE_TOOLS";
  vocabularyVersions: number[];
  tools: { id: NativeToolId; version: string; actions: string[] }[];
}
export interface RuntimeNativeToolRequirementSet {
  vocabulary: "JENTRA_NATIVE_TOOLS";
  acceptedVocabularyVersions?: number[];
  tools: { id: NativeToolId; minimumVersion?: string; actions?: string[] }[];
}
export interface NativeToolNegotiation {
  compatible: boolean;
  vocabularyVersion?: number;
  negotiatedTools: { id: NativeToolId; version: string; actions: string[] }[];
  issues: {
    code:
      | "VOCABULARY_VERSION_UNSUPPORTED"
      | "TOOL_NOT_ADVERTISED"
      | "TOOL_VERSION_INCOMPATIBLE"
      | "TOOL_ACTION_MISSING";
    toolId?: NativeToolId;
    detail: string;
  }[];
}

export type CoordinationGroupRequest = Record<string, unknown> & {
  id: string;
  worldId: string;
  version: number;
};

export interface MemoryCreateRequest {
  memoryId: string;
  sourceEnvelopeId: string;
  origin:
    | "USER_STATEMENT"
    | "JENTRA_EVENT"
    | "GIT_OBJECT"
    | "VERIFIED_CONTRIBUTION"
    | "EXTERNAL_CONTENT"
    | "TOOL_RESULT"
    | "AGENT_OUTPUT"
    | "IMPORTED_MEMORY";
  sourceRef: string;
  sourceHash: string;
  independentSourceId: string;
  memoryClass:
    | "WORKING"
    | "WORLD"
    | "PERSONAL"
    | "JOURNEY_KNOWLEDGE"
    | "ORGANIZATION_KNOWLEDGE";
  summary: string;
  content: string;
  confidence?: number;
  validFrom: string;
  validUntil?: string;
  supersedes?: string[];
  contradicts?: string[];
  corroboratingSourceIds?: string[];
}

export class JentraApiError extends Error {
  readonly code: string;
  readonly targetRef: string | undefined;
  readonly currentVersion: number | undefined;
  readonly retryClass: ApiError["retryClass"];
  readonly remediationActions: string[];
  readonly correlationId: string;

  constructor(
    readonly detail: ApiError,
    readonly status: number,
  ) {
    super(detail.messagePlain);
    this.name = "JentraApiError";
    this.code = detail.code;
    this.targetRef = detail.targetRef;
    this.currentVersion = detail.currentVersion;
    this.retryClass = detail.retryClass;
    this.remediationActions = [...detail.remediationActions];
    this.correlationId = detail.correlationId;
  }
}

export class JentraClient {
  private readonly fetcher: typeof fetch;
  private readonly authenticationHeaders: () => Promise<Record<string, string>>;
  constructor(
    private readonly baseUrl: string,
    options:
      | typeof fetch
      | {
          fetcher?: typeof fetch;
          authenticationHeaders?: () => Promise<Record<string, string>>;
        } = fetch,
  ) {
    this.fetcher =
      typeof options === "function" ? options : (options.fetcher ?? fetch);
    this.authenticationHeaders =
      typeof options === "function"
        ? async () => ({})
        : (options.authenticationHeaders ?? (async () => ({})));
  }
  async command(command: CommandEnvelope): Promise<CommandReceipt> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/journeys/${encodeURIComponent(command.journeyId)}/commands`,
      {
        method: "POST",
        headers: {
          ...(await this.authenticationHeaders()),
          "content-type": "application/json",
          "idempotency-key": command.idempotencyKey,
        },
        body: JSON.stringify(command),
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) throw apiError(response.status, body);
    return CommandReceiptSchema.parse(body);
  }
  async journey(journeyId: string): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/journeys/${encodeURIComponent(journeyId)}`,
      { headers: await this.authenticationHeaders() },
    );
    return responseBody(response);
  }
  async journeyCapsule(journeyId: string): Promise<JourneyCapsuleV1> {
    return JourneyCapsuleV1Schema.parse(
      await this.get(`/v1/journeys/${encodeURIComponent(journeyId)}/capsule`),
    );
  }
  async uploadArtifact(
    digest: string,
    bytes: Uint8Array,
    mediaType = "application/octet-stream",
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/artifacts/${encodeURIComponent(digest)}`,
      {
        method: "PUT",
        headers: {
          ...(await this.authenticationHeaders()),
          "content-type": mediaType,
        },
        body: Uint8Array.from(bytes).buffer,
      },
    );
    return responseBody(response);
  }
  async directions(journeyId: string): Promise<unknown> {
    return this.get(`/v1/journeys/${encodeURIComponent(journeyId)}/directions`);
  }
  /** @deprecated Use directions(). */
  async goals(journeyId: string): Promise<unknown> {
    return this.directions(journeyId);
  }
  async attention(
    journeyId: string,
    mode: "guided" | "advanced" = "guided",
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/journeys/${encodeURIComponent(journeyId)}/attention?mode=${mode}`,
      { headers: await this.authenticationHeaders() },
    );
    return responseBody(response);
  }
  async assurance(
    journeyId: string,
    mode: "guided" | "advanced" = "guided",
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/journeys/${encodeURIComponent(journeyId)}/assurance?mode=${mode}`,
      { headers: await this.authenticationHeaders() },
    );
    return responseBody(response);
  }
  async decisions(
    journeyId: string,
    mode: "guided" | "advanced" = "guided",
  ): Promise<unknown> {
    return this.queryJourneyView(journeyId, "decisions", mode);
  }
  async resolution(
    journeyId: string,
    mode: "guided" | "advanced" = "guided",
  ): Promise<unknown> {
    return this.queryJourneyView(journeyId, "resolution", mode);
  }
  async quickStartPreview(
    answers: QuickStartAnswersContract,
  ): Promise<unknown> {
    return this.post("/v1/quick-start/preview", answers);
  }
  async startProject(request: ProjectStartRequestContract): Promise<unknown> {
    return this.post("/v1/projects", request);
  }
  async createProject(request: ProjectCreateRequestContract): Promise<unknown> {
    return this.post("/v1/projects", request);
  }
  async project(projectId: string): Promise<unknown> {
    return this.get(`/v1/projects/${encodeURIComponent(projectId)}`);
  }
  async projectCollaboration(projectId: string): Promise<unknown> {
    return this.get(
      `/v1/projects/${encodeURIComponent(projectId)}/collaboration`,
    );
  }
  async runtimeDiagnostics(
    filter: {
      adapter?: string;
      requiredCapabilities?: string[];
      nativeTools?: RuntimeNativeToolRequirementSet;
    } = {},
  ): Promise<RuntimeHostDiagnostic[]> {
    const query = new URLSearchParams();
    if (filter.adapter) query.set("adapter", filter.adapter);
    if (filter.requiredCapabilities?.length)
      query.set("capabilities", filter.requiredCapabilities.join(","));
    if (filter.nativeTools)
      return (await this.post("/v1/runtime-diagnostics", {
        ...(filter.adapter ? { adapter: filter.adapter } : {}),
        requiredCapabilities: filter.requiredCapabilities ?? [],
        nativeTools: filter.nativeTools,
      })) as RuntimeHostDiagnostic[];
    const suffix = query.size ? `?${query.toString()}` : "";
    return (await this.get(
      `/v1/runtime-diagnostics${suffix}`,
    )) as RuntimeHostDiagnostic[];
  }
  async putDeliveryBoundary(
    projectId: string,
    boundaryId: string,
    request: DeliveryBoundaryMutation,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/delivery-boundaries/${encodeURIComponent(boundaryId)}`,
      request,
    );
  }
  async putCredentialReference(
    projectId: string,
    credentialId: string,
    request: CredentialReferenceMutation,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/credential-references/${encodeURIComponent(credentialId)}`,
      request,
    );
  }
  async deleteCredentialReference(
    projectId: string,
    credentialId: string,
    expectedVersion: number,
  ): Promise<unknown> {
    return this.deleteWithBody(
      `/v1/projects/${encodeURIComponent(projectId)}/credential-references/${encodeURIComponent(credentialId)}`,
      { expectedVersion },
    );
  }
  async putCapabilityBinding(
    projectId: string,
    bindingId: string,
    request: CapabilityBindingMutation,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/capability-bindings/${encodeURIComponent(bindingId)}`,
      request,
    );
  }
  async deleteCapabilityBinding(
    projectId: string,
    bindingId: string,
    expectedVersion: number,
  ): Promise<unknown> {
    return this.deleteWithBody(
      `/v1/projects/${encodeURIComponent(projectId)}/capability-bindings/${encodeURIComponent(bindingId)}`,
      { expectedVersion },
    );
  }
  async putSourceConnection(
    projectId: string,
    connectionId: string,
    request: SourceConnectionMutation,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/source-connections/${encodeURIComponent(connectionId)}`,
      request,
    );
  }
  async putProjectAutonomyPolicy(
    projectId: string,
    request: ProjectAutonomyPolicyMutation,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/autonomy-policy`,
      request,
    );
  }
  async projectPeopleAndAgents(projectId: string): Promise<unknown> {
    return this.get(
      `/v1/projects/${encodeURIComponent(projectId)}/people-agents`,
    );
  }
  async previewProjectActivity(
    projectId: string,
    request: ProjectActivityPreviewRequestContract,
  ): Promise<unknown> {
    return this.post(
      `/v1/projects/${encodeURIComponent(projectId)}/activity-preview`,
      request,
    );
  }
  async startJourney(
    projectId: string,
    request: ProjectJourneyStartRequestContract,
  ): Promise<unknown> {
    return this.post(
      `/v1/projects/${encodeURIComponent(projectId)}/journeys`,
      request,
    );
  }
  async connectProjectAgent(
    projectId: string,
    request: ProjectAgentConnectionRequestContract,
  ): Promise<unknown> {
    return this.post(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-connections`,
      request,
    );
  }
  async putAgentProfile(
    projectId: string,
    profile: AgentSetupProfile,
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-profiles/${encodeURIComponent(profile.profileId)}`,
      profile,
    );
  }
  async agentProfile(projectId: string, profileId: string): Promise<unknown> {
    return this.get(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-profiles/${encodeURIComponent(profileId)}`,
    );
  }
  async approveAgentProfile(
    projectId: string,
    profileId: string,
    request: { revision: number; profileHash: string },
  ): Promise<unknown> {
    return this.post(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-profiles/${encodeURIComponent(profileId)}/approve`,
      request,
    );
  }
  async evaluateAgentProfile(
    projectId: string,
    profileId: string,
    inventory: HarnessInventory,
  ): Promise<unknown> {
    return this.post(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-profiles/${encodeURIComponent(profileId)}/compatibility`,
      inventory,
    );
  }
  async bindAgentProfile(
    projectId: string,
    request: {
      scope: "PROJECT" | "JOURNEY" | "ASSIGNMENT";
      targetId: string;
      profileId: string;
      revision: number;
    },
  ): Promise<unknown> {
    return this.put(
      `/v1/projects/${encodeURIComponent(projectId)}/agent-profile-bindings`,
      request,
    );
  }
  /** @deprecated Connect the integration at Project scope, then assign it to Journey work explicitly. */
  async connectAgent(
    journeyId: string,
    request: AgentConnectionRequestContract,
  ): Promise<unknown> {
    return this.post(
      `/v1/journeys/${encodeURIComponent(journeyId)}/agent-connections`,
      request,
    );
  }
  async evaluateHarness(
    descriptor: HarnessDescriptorContract,
  ): Promise<unknown> {
    return this.post("/v1/harness/conformance", descriptor);
  }
  async experience(
    journeyId: string,
    mode: "guided" | "standard" | "advanced" = "guided",
  ): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/experience?mode=${mode}`,
    );
  }
  async why(
    journeyId: string,
    ref: string,
    mode: "guided" | "standard" | "advanced" = "guided",
  ): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/why?ref=${encodeURIComponent(ref)}&mode=${mode}`,
    );
  }
  async review(
    journeyId: string,
    mode: "guided" | "standard" | "advanced" = "guided",
  ): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/review?mode=${mode}`,
    );
  }
  async changeReview(journeyId: string): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/change-review`,
    );
  }
  async journeyPeopleAndAgents(journeyId: string): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/people-agents`,
    );
  }
  async proposeAdaptivePlan(input: AdaptivePlanningRequest): Promise<unknown> {
    return this.post("/v1/adaptive-plans", input);
  }
  async acceptAdaptivePlan(
    planId: string,
    request: { journeyId: string; worldId?: string; expectedVersion: number },
  ): Promise<unknown> {
    return this.post(
      `/v1/adaptive-plans/${encodeURIComponent(planId)}/accept`,
      request,
    );
  }
  async admitAdaptiveRun(
    request: AdaptiveRunAdmissionRequest,
  ): Promise<unknown> {
    return this.post("/v1/adaptive-runs/admit", request);
  }
  async adaptiveRunAction(
    runId: string,
    action:
      | "ready"
      | "reserve"
      | "start"
      | "checkpoint"
      | "resume"
      | "finish"
      | "cancel",
    request: Record<string, unknown> & { journeyId: string; worldId: string },
  ): Promise<unknown> {
    return this.post(
      `/v1/adaptive-runs/${encodeURIComponent(runId)}/${encodeURIComponent(action)}`,
      request,
    );
  }
  async adaptiveRunSummary(
    journeyId: string,
    worldId: string,
  ): Promise<unknown> {
    return this.get(
      `/v1/adaptive-runs/summary?journeyId=${encodeURIComponent(journeyId)}&worldId=${encodeURIComponent(worldId)}`,
    );
  }
  async adaptiveConcurrency(
    journeyId: string,
    worldId: string,
  ): Promise<AdaptiveConcurrencySummary> {
    return this.get(
      `/v1/adaptive-runs/concurrency?journeyId=${encodeURIComponent(journeyId)}&worldId=${encodeURIComponent(worldId)}`,
    ) as Promise<AdaptiveConcurrencySummary>;
  }
  async putCoordinationGroup(
    journeyId: string,
    group: CoordinationGroupRequest,
  ): Promise<unknown> {
    return this.post("/v1/coordination-groups", { journeyId, group });
  }
  async coordinationGroups(
    journeyId: string,
    worldId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams({ journeyId, worldId });
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));
    return this.get(`/v1/coordination-groups?${query.toString()}`);
  }
  async writeMemory(request: MemoryCreateRequest): Promise<unknown> {
    return this.post("/v1/memories", request);
  }
  async memories(
    options: { cursor?: string; limit?: number; includeDeleted?: boolean } = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));
    if (options.includeDeleted) query.set("includeDeleted", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.get(`/v1/memories${suffix}`);
  }
  async memory(memoryId: string): Promise<unknown> {
    return this.get(`/v1/memories/${encodeURIComponent(memoryId)}`);
  }
  async correctMemory(
    memoryId: string,
    request: MemoryCreateRequest,
  ): Promise<unknown> {
    return this.post(
      `/v1/memories/${encodeURIComponent(memoryId)}/correct`,
      request,
    );
  }
  async forgetMemory(memoryId: string): Promise<unknown> {
    return this.post(`/v1/memories/${encodeURIComponent(memoryId)}/forget`, {});
  }
  async purgeMemory(memoryId: string): Promise<unknown> {
    return this.delete(`/v1/memories/${encodeURIComponent(memoryId)}/purge`);
  }
  async exportMemories(): Promise<unknown> {
    return this.get("/v1/memories/export");
  }
  async memorySelection(): Promise<unknown> {
    return this.get("/v1/memories/selection");
  }
  async setMemorySelection(request: {
    selectedMemoryIds: string[];
    characterBudget?: number;
    advisoryRecallEnabled?: boolean;
  }): Promise<unknown> {
    return this.put("/v1/memories/selection", request);
  }
  async searchMemories(query: string): Promise<unknown> {
    return this.get(`/v1/memories/search?q=${encodeURIComponent(query)}`);
  }
  async enforceMemoryRetention(): Promise<unknown> {
    return this.post("/v1/memories/retention/enforce", {});
  }
  async memoryUsage(): Promise<unknown> {
    return this.get("/v1/memories/usage");
  }
  async createMemoryExtractionCandidate(request: {
    consent: true;
    memoryId?: string;
    sourceEnvelopeId: string;
    sourceRef: string;
    independentSourceId: string;
    summary: string;
    content: string;
    confidence?: number;
    retentionUntil?: string;
  }): Promise<unknown> {
    return this.post("/v1/memories/extraction-candidates", request);
  }
  async journeyMemories(journeyId: string): Promise<unknown> {
    return this.get(`/v1/journeys/${encodeURIComponent(journeyId)}/memories`);
  }
  async memoryPromotions(journeyId: string): Promise<unknown> {
    return this.get(
      `/v1/journeys/${encodeURIComponent(journeyId)}/memory-promotions`,
    );
  }
  async requestMemoryPromotion(
    journeyId: string,
    request: { promotionId: string; memoryId: string; rationale: string },
  ): Promise<unknown> {
    return this.post(
      `/v1/journeys/${encodeURIComponent(journeyId)}/memory-promotions`,
      request,
    );
  }
  async reviewMemoryPromotion(
    journeyId: string,
    promotionId: string,
    decision: "APPROVED" | "REJECTED",
  ): Promise<unknown> {
    return this.post(
      `/v1/journeys/${encodeURIComponent(journeyId)}/memory-promotions/${encodeURIComponent(promotionId)}/review`,
      { decision },
    );
  }
  async retractJourneyMemory(
    journeyId: string,
    memoryId: string,
    reason: string,
  ): Promise<unknown> {
    return this.deleteWithBody(
      `/v1/journeys/${encodeURIComponent(journeyId)}/memories/${encodeURIComponent(memoryId)}`,
      { reason },
    );
  }
  private async get(path: string): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: await this.authenticationHeaders(),
    });
    return responseBody(response);
  }
  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...(await this.authenticationHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return responseBody(response);
  }
  private async put(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: {
        ...(await this.authenticationHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return responseBody(response);
  }
  private async delete(path: string): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: await this.authenticationHeaders(),
    });
    return responseBody(response);
  }
  private async deleteWithBody(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: {
        ...(await this.authenticationHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return responseBody(response);
  }
  private async queryJourneyView(
    journeyId: string,
    view: "decisions" | "resolution",
    mode: "guided" | "advanced",
  ): Promise<unknown> {
    const response = await this.fetcher(
      `${this.baseUrl}/v1/journeys/${encodeURIComponent(journeyId)}/${view}?mode=${mode}`,
      { headers: await this.authenticationHeaders() },
    );
    return responseBody(response);
  }
}

async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) throw apiError(response.status, body);
  return body;
}

function apiError(status: number, body: unknown): JentraApiError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new JentraApiError(parsed.data, status);
  return new JentraApiError(
    {
      code: "UNEXPECTED_API_ERROR",
      messagePlain: `Request failed with HTTP ${String(status)}.`,
      retryClass: "NEVER",
      remediationActions: [],
      correlationId: "unavailable",
    },
    status,
  );
}
