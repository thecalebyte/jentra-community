import { z } from "zod";

const Id = z.string().min(1).max(160);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Timestamp = z.iso.datetime({ offset: true });

export const ActorReferenceSchema = z.object({
  participantId: Id,
  clientSessionId: Id.optional(),
  runtimeId: Id.optional(),
});

export const AuthorityReferenceSchema = z.object({
  roleBindingId: Id,
  capabilityGrantIds: z.array(Id).min(1),
});

export const CommandEnvelopeSchema = z.object({
  commandId: Id,
  commandType: z.string().min(1),
  schemaVersion: z.literal(1),
  journeyId: Id,
  aggregateVersionExpected: z.union([
    z.number().int().nonnegative(),
    z.literal("ANY_ALLOWED"),
  ]),
  actor: ActorReferenceSchema,
  authority: AuthorityReferenceSchema,
  policySnapshotId: Id,
  correlationId: Id,
  causationId: Id.optional(),
  idempotencyKey: z.string().min(8).max(240),
  receivedAt: Timestamp,
  payload: z.record(z.string(), z.unknown()),
  payloadHash: Hash,
});

export const DomainEventEnvelopeSchema = z.object({
  eventId: Id,
  journeyId: Id,
  journeySequence: z.number().int().positive(),
  aggregateVersion: z.number().int().positive(),
  eventType: z.string().min(1),
  schemaVersion: z.literal(1),
  occurredAt: Timestamp,
  recordedAt: Timestamp,
  actor: ActorReferenceSchema,
  authority: AuthorityReferenceSchema.optional(),
  correlationId: Id,
  causationId: Id.optional(),
  commandId: Id,
  policySnapshotId: Id,
  payload: z.record(z.string(), z.unknown()),
  payloadHash: Hash,
  previousEventHash: Hash.optional(),
  eventHash: Hash,
});

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  messagePlain: z.string().min(1),
  targetRef: Id.optional(),
  currentVersion: z.number().int().nonnegative().optional(),
  retryClass: z.enum([
    "NEVER",
    "SAFE_SAME_KEY",
    "REREAD_REQUIRED",
    "USER_ACTION",
    "LATER",
  ]),
  remediationActions: z.array(z.string()),
  correlationId: Id,
});

export const OperationSchema = z.object({
  id: Id,
  type: z.string().min(1),
  status: z.enum([
    "PENDING",
    "RUNNING",
    "WAITING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "UNKNOWN",
  ]),
  inputHash: Hash,
  resultRef: Id.optional(),
  attempt: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const CommandReceiptSchema = z.object({
  commandId: Id,
  idempotencyKey: z.string(),
  payloadHash: Hash,
  status: z.enum(["ACCEPTED", "REJECTED"]),
  aggregateVersion: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
  result: z.record(z.string(), z.unknown()),
});

export const CoordinationRequestPayloadSchema = z.object({
  requestId: Id,
  sourceRoleBindingId: Id,
  sourceAssignmentId: Id,
  targetWorkstreamId: Id,
  targetScope: z.enum([
    "WORKSTREAM",
    "CROSS_WORKSTREAM",
    "JOURNEY",
    "HUMAN_AUTHORITY",
  ]),
  requestType: z.enum([
    "DEPENDENCY_REPORT",
    "OVERLAP_REPORT",
    "CONTRACT_REQUEST",
    "BLOCKER_REPORT",
    "PAIR_REQUEST",
    "ASSISTANCE_REQUEST",
  ]),
  subjectKey: Id,
  subjectVersion: z.number().int().nonnegative(),
  summary: z.string().min(1),
  requestedOutcome: z.string().min(1),
  urgency: z.enum([
    "INFORMATIONAL",
    "ACTION_REQUIRED",
    "BLOCKING",
    "URGENT",
    "SECURITY_CRITICAL",
  ]),
  evidenceRefs: z.array(Id),
  dissentRefs: z.array(Id),
});
export const ContextManifestSchema = z.object({
  id: Id,
  assignmentId: Id,
  worldId: Id,
  baselineCommit: Id,
  scopeRefs: z.array(Id),
  contractRefs: z.array(Id),
  dependencyRefs: z.array(Id),
  discoveryRefs: z.array(Id),
  policySnapshotId: Id,
  generatedAt: Timestamp,
  contentHash: Hash,
});
export const AttentionItemViewSchema = z.object({
  id: Id,
  severity: z.enum([
    "INFORMATIONAL",
    "ACTION_REQUIRED",
    "BLOCKING",
    "URGENT",
    "SECURITY_CRITICAL",
  ]),
  title: z.string().min(1),
  explanation: z.string().min(1),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPERSEDED"]),
  version: z.number().int().positive(),
});
export const VerificationSubjectManifestSchema = z.object({
  id: Id,
  planId: Id,
  subjectRef: Id,
  subjectHash: Hash,
  candidateHash: Hash,
  claimRefs: z.array(Id).min(1),
  evidenceRefs: z.array(Id),
  counterevidenceRefs: z.array(Id),
  contextManifestHash: Hash,
  contractRefs: z.array(Id),
  dependencyRefs: z.array(Id),
  knownLimitations: z.array(z.string()),
  policySnapshotId: Id,
  contentHash: Hash,
});
export const AssuranceFindingSchema = z.object({
  id: Id,
  runId: Id,
  type: z.enum([
    "CONFIRMING",
    "COUNTEREXAMPLE",
    "GAP",
    "RISK",
    "ASSUMPTION",
    "REGRESSION",
    "SECURITY",
  ]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  statement: z.string().min(1),
  affectedClaimRefs: z.array(Id),
  evidenceRefs: z.array(Id).min(1),
  reproductionRef: Id.optional(),
  status: z.enum([
    "OPEN",
    "CONFIRMED",
    "DISPUTED",
    "RESOLVED",
    "ACCEPTED_RISK",
    "SUPERSEDED",
  ]),
  authoredBy: Id,
  version: z.number().int().positive(),
});
export const AssuranceOutcomeSchema = z.object({
  planId: Id,
  subjectRef: Id,
  runIds: z.array(Id).min(1),
  unresolvedFindingIds: z.array(Id),
  result: z.enum(["PASSED", "FAILED", "INCONCLUSIVE", "BLOCKED", "STALE"]),
  contentHash: Hash,
});
export const DecisionCaseViewSchema = z.object({
  id: Id,
  questionPlain: z.string().min(1),
  consequencePlain: z.string().min(1),
  recommendedOptionId: Id,
  selectedOptionId: Id.optional(),
  status: z.enum(["AWAITING_DECISION", "DECIDED", "SUPERSEDED"]),
  version: z.number().int().positive(),
});
export const CandidateResolutionViewSchema = z.object({
  id: Id,
  planId: Id,
  headCommit: Id,
  treeSha: Id,
  contentHash: Hash,
  status: z.enum([
    "CANDIDATE",
    "VERIFYING",
    "VERIFIED",
    "FAILED",
    "SUPERSEDED",
    "RESOLVED",
  ]),
});
export const QuickStartAnswersSchema = z.object({
  outcome: z.string().trim().min(1).max(4_000),
  workKind: z
    .enum([
      "GENERAL",
      "SOFTWARE",
      "RESEARCH",
      "MARKETING",
      "OPERATIONS",
      "CREATIVE",
    ])
    .default("GENERAL"),
  source: z.enum(["NEW_PROJECT", "EXISTING_REPOSITORY", "FILES"]),
  autonomy: z.enum([
    "GUIDED",
    "BALANCED",
    "BOUNDED_AUTONOMOUS",
    "HUMAN_IMPLEMENTATION",
  ]),
  constraints: z.object({
    sensitiveData: z.boolean(),
    deploymentRequiresHuman: z.boolean(),
    requiredHumanDecisions: z.boolean(),
    budgetLimit: z.number().positive(),
    timeLimitMinutes: z.number().int().positive().max(43_200),
  }),
});
export const HarnessDescriptorSchema = z.object({
  name: Id,
  level: z.enum(["GIT_ONLY", "GENERIC_CLI_SDK", "NATIVE_ADAPTER"]),
  supportsGit: z.boolean(),
  supportsManifest: z.boolean(),
  supportsStructuredResults: z.boolean(),
  claimsHumanApproval: z.boolean(),
});
export const ProjectStartRequestSchema = z.object({
  projectId: z.uuid().optional(),
  answers: QuickStartAnswersSchema,
});
export const AgentConnectionRequestSchema = z.object({
  connectionId: z.uuid(),
  displayName: z.string().trim().min(1).max(120),
  level: z.enum(["GIT_ONLY", "GENERIC_CLI_SDK", "NATIVE_ADAPTER"]),
});

export const ActivityLayerSchema = z.enum([
  "DIRECT",
  "QUICK_TASK",
  "MANAGED_JOURNEY",
]);
export const AgentOperatingScopeSchema = z.enum([
  "PROJECT_SERVICE",
  "JOURNEY_PARTICIPANT",
  "ASSIGNMENT_WORKER",
  "INDEPENDENT_VERIFIER",
]);
export const ProjectCreateRequestSchema = z.object({
  projectId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160),
  source: z.enum(["NEW_PROJECT", "EXISTING_REPOSITORY", "FILES"]),
});
export const ProjectActivityPreviewRequestSchema = z.object({
  requestedLayer: ActivityLayerSchema.optional(),
  mutatesCanonicalSource: z.boolean(),
  needsIsolatedWorkspace: z.boolean(),
  requiresIndependentVerification: z.boolean(),
  hasReservedHumanDecision: z.boolean(),
  participantCount: z.number().int().nonnegative().max(10_000),
  dependencyCount: z.number().int().nonnegative().max(10_000),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  disposableExploration: z.boolean(),
});
export const ProjectJourneyStartRequestSchema = z.object({
  journeyId: z.uuid().optional(),
  layer: z.enum(["QUICK_TASK", "MANAGED_JOURNEY"]),
  answers: QuickStartAnswersSchema,
});
export const ProjectAgentConnectionRequestSchema =
  AgentConnectionRequestSchema.extend({
    operatingScope: AgentOperatingScopeSchema.default("PROJECT_SERVICE"),
    serviceCapabilities: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .default([]),
  });

export const ModelRoleSchema = z.enum([
  "WORK",
  "DECISION_ADVISER",
  "INDEPENDENT_VERIFIER",
  "FALLBACK",
]);
export const ModelSelectionSchema = z.object({
  role: ModelRoleSchema,
  provider: Id,
  model: Id,
  connectionRef: Id.optional(),
});
export const PortableSkillRequirementSchema = z.object({
  id: Id,
  source: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(120),
  integrity: Hash,
  optional: z.boolean().default(false),
  compatibleHarnesses: z.array(Id).max(50).default([]),
  requiredCapabilities: z.array(Id).max(50).default([]),
});
export const PortableMcpRequirementSchema = z.object({
  id: Id,
  transport: z.enum(["STDIO", "STREAMABLE_HTTP", "SSE"]),
  endpointHint: z.string().trim().min(1).max(500).optional(),
  requiredCapabilities: z.array(Id).max(50).default([]),
});
export const NativeToolIdSchema = z.enum([
  "terminal",
  "filesystem",
  "git",
  "browser",
  "http",
  "mcp",
  "database",
  "communication",
  "deployment",
  "desktop",
  "mobile",
  "simulator",
]);
export const NativeToolVersionSchema = z
  .string()
  .regex(
    /^\d+\.\d+(?:\.\d+)?$/,
    "Use a numeric major.minor or major.minor.patch version.",
  );
export const NativeToolActionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{0,79}$/);
export const RuntimeNativeToolSchema = z.object({
  id: NativeToolIdSchema,
  version: NativeToolVersionSchema,
  actions: z.array(NativeToolActionSchema).max(128).default([]),
});
export const RuntimeNativeToolManifestSchema = z
  .object({
    vocabulary: z.literal("JENTRA_NATIVE_TOOLS"),
    vocabularyVersions: z
      .array(z.number().int().positive().max(32))
      .min(1)
      .max(8),
    tools: z.array(RuntimeNativeToolSchema).max(64),
  })
  .superRefine((manifest, context) => {
    if (
      new Set(manifest.vocabularyVersions).size !==
      manifest.vocabularyVersions.length
    )
      context.addIssue({
        code: "custom",
        message: "Native-tool vocabulary versions must be unique.",
      });
    const ids = manifest.tools.map((tool) => tool.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Native-tool identifiers must be unique.",
      });
  });
export const RuntimeNativeToolRequirementSchema = z.object({
  id: NativeToolIdSchema,
  minimumVersion: NativeToolVersionSchema.default("1.0"),
  actions: z.array(NativeToolActionSchema).max(128).default([]),
});
export const RuntimeNativeToolRequirementSetSchema = z
  .object({
    vocabulary: z.literal("JENTRA_NATIVE_TOOLS"),
    acceptedVocabularyVersions: z
      .array(z.number().int().positive().max(32))
      .min(1)
      .max(8)
      .default([1]),
    tools: z.array(RuntimeNativeToolRequirementSchema).max(64).default([]),
  })
  .superRefine((requirement, context) => {
    if (
      new Set(requirement.acceptedVocabularyVersions).size !==
      requirement.acceptedVocabularyVersions.length
    )
      context.addIssue({
        code: "custom",
        message: "Accepted native-tool vocabulary versions must be unique.",
      });
    const ids = requirement.tools.map((tool) => tool.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Required native-tool identifiers must be unique.",
      });
  });

export const ToolOperationSchema = z.enum([
  "READ",
  "WRITE",
  "PUBLISH",
  "SEND",
  "SPEND",
  "DELETE",
]);
export const ToolInvocationSchema = z.object({
  invocationId: Id,
  toolGrantId: Id,
  operation: ToolOperationSchema,
  targetRef: z.string().min(1),
  parametersHash: Hash,
  idempotencyKey: z.string().min(8),
  requestedAt: Timestamp,
  approvalRef: Id.optional(),
  spend: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3),
    })
    .optional(),
});
export const ExternalEffectReceiptSchema = z.object({
  invocationId: Id,
  toolId: Id,
  operation: ToolOperationSchema,
  targetRef: z.string().min(1),
  status: z.enum(["SUCCEEDED", "FAILED", "UNKNOWN"]),
  idempotencyKey: z.string().min(8),
  attemptedAt: Timestamp,
  completedAt: Timestamp.optional(),
  externalRef: z.string().min(1).optional(),
  externalVersion: z.string().min(1).optional(),
  evidenceRefs: z.array(z.string().min(1)).max(128),
  reversible: z.boolean(),
  spend: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3),
    })
    .optional(),
});
export type ToolOperation = z.infer<typeof ToolOperationSchema>;
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type ExternalEffectReceipt = z.infer<typeof ExternalEffectReceiptSchema>;
export const AgentSetupProfileSchema = z
  .object({
    schema: z.literal("JENTRA_AGENT_PROFILE"),
    schemaVersion: z.literal(1),
    profileId: Id,
    name: z.string().trim().min(1).max(160),
    revision: z.number().int().positive(),
    modelRoles: z.array(ModelSelectionSchema).max(4),
    skills: z.array(PortableSkillRequirementSchema).max(100),
    mcpServers: z.array(PortableMcpRequirementSchema).max(50),
    requiredCapabilities: z.array(Id).max(100),
    requiredNativeTools: RuntimeNativeToolRequirementSetSchema.optional(),
    harnessPolicy: z
      .object({
        preferredProviderIds: z.array(Id).min(1).max(20),
        allowFallback: z.boolean(),
      })
      .optional(),
    installPolicy: z.literal("EXPLICIT_APPROVAL"),
  })
  .strict()
  .superRefine((profile, context) => {
    const roles = profile.modelRoles.map((item) => item.role);
    if (new Set(roles).size !== roles.length)
      context.addIssue({
        code: "custom",
        message: "Model roles must be unique.",
        path: ["modelRoles"],
      });
  });
export const HarnessInventorySchema = z.object({
  harness: Id,
  harnessVersion: z.string().trim().min(1).max(120),
  capabilities: z.array(Id).max(200),
  nativeTools: RuntimeNativeToolManifestSchema.optional(),
  models: z.array(z.object({ provider: Id, model: Id })).max(200),
  skills: z
    .array(z.object({ id: Id, version: z.string().min(1), integrity: Hash }))
    .max(200),
  mcpServers: z
    .array(
      z.object({
        id: Id,
        transport: z.enum(["STDIO", "STREAMABLE_HTTP", "SSE"]),
      }),
    )
    .max(100),
});
export const AgentProfileApprovalSchema = z.object({
  profileId: Id,
  revision: z.number().int().positive(),
  profileHash: Hash,
  approvedByParticipantId: Id,
  approvedAt: Timestamp,
});
export const AgentProfileApprovalRequestSchema =
  AgentProfileApprovalSchema.pick({
    revision: true,
    profileHash: true,
  });
export const AgentProfileBindingSchema = z.object({
  scope: z.enum(["PROJECT", "JOURNEY", "ASSIGNMENT"]),
  targetId: Id,
  profileId: Id,
  revision: z.number().int().positive(),
  boundByParticipantId: Id,
  boundAt: Timestamp,
});
export const AgentProfileBindingRequestSchema = AgentProfileBindingSchema.pick({
  scope: true,
  targetId: true,
  profileId: true,
  revision: true,
});

const ProjectVersionMutationSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const DeliveryBoundarySchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["DEVELOPMENT", "STAGING", "PRODUCTION", "CUSTOM"]),
  allowedActions: z.array(Id).min(1).max(100),
  humanApprovalRequired: z.boolean(),
  active: z.boolean().default(true),
  revision: z.number().int().positive(),
});
export const DeliveryBoundaryMutationSchema = DeliveryBoundarySchema.extend(
  ProjectVersionMutationSchema.shape,
);

export const CredentialReferenceSchema = z.object({
  id: Id,
  label: z.string().trim().min(1).max(120),
  providerKind: z.enum([
    "JENTRA_MANAGED",
    "RUNTIME_MANAGED",
    "CLOUDFLARE_SECRET_STORE",
    "EXTERNAL_VAULT",
  ]),
  providerRef: z.string().trim().min(1).max(500),
  revision: z.number().int().positive(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export const CredentialReferenceMutationSchema =
  CredentialReferenceSchema.extend(ProjectVersionMutationSchema.shape);

export const CapabilityBindingSchema = z.object({
  id: Id,
  subjectKind: z.enum(["PARTICIPANT", "ROLE", "ASSIGNMENT", "RUNTIME"]),
  subjectId: Id,
  boundaryId: Id,
  credentialReferenceId: Id.optional(),
  actions: z.array(Id).min(1).max(100),
  constraints: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  expiresAt: Timestamp.optional(),
  active: z.boolean().default(true),
});
export const CapabilityBindingMutationSchema = CapabilityBindingSchema.extend(
  ProjectVersionMutationSchema.shape,
);

const HttpsGitRemoteSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:")
      context.addIssue({
        code: "custom",
        message: "Git remotes must use HTTPS.",
      });
    if (parsed.username || parsed.password)
      context.addIssue({
        code: "custom",
        message: "Git remotes cannot contain credentials.",
      });
  });

export const SourceConnectionSchema = z.object({
  id: Id,
  provider: z.enum(["GITHUB", "GITLAB", "BITBUCKET", "GENERIC_HTTPS"]),
  remoteUrl: HttpsGitRemoteSchema,
  defaultBranch: z.string().trim().min(1).max(200).default("main"),
  credentialReferenceId: Id.optional(),
  syncMode: z.enum(["IMPORT_ONCE", "TRACK_UPSTREAM"]),
  privateSource: z.boolean().default(false),
  status: z
    .enum(["CONFIGURED", "IMPORTING", "READY", "FAILED"])
    .default("CONFIGURED"),
  failureCode: Id.optional(),
  operationId: Id.optional(),
});
export const SourceConnectionMutationSchema = SourceConnectionSchema.omit({
  status: true,
  failureCode: true,
  operationId: true,
}).extend(ProjectVersionMutationSchema.shape);

export const ProjectAutonomyPolicySchema = z.object({
  mode: z.enum([
    "SUPERVISED",
    "BALANCED",
    "AUTONOMOUS_WITHIN_POLICY",
    "HUMAN_EXECUTION",
  ]),
  requireIndependentVerification: z.boolean(),
  reservedActions: z.array(Id).max(100),
  allowAgentDelegation: z.boolean(),
  maxParallelRuns: z.number().int().positive().max(10_000),
  revision: z.number().int().positive(),
});
export const ProjectAutonomyPolicyMutationSchema =
  ProjectAutonomyPolicySchema.extend(ProjectVersionMutationSchema.shape);

export const SourceMaterialisationSchema = z
  .object({
    mode: z.enum(["METADATA_ONLY", "SPARSE", "FULL", "EXTERNAL"]),
    sourceRef: z.string().trim().min(1).max(2_048),
    baselineRef: Id,
    sparsePaths: z
      .array(z.string().trim().min(1).max(500))
      .max(1_000)
      .default([]),
    externalWorkspaceRef: z.string().trim().min(1).max(2_048).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "SPARSE" && value.sparsePaths.length === 0)
      context.addIssue({
        code: "custom",
        path: ["sparsePaths"],
        message: "SPARSE_PATHS_REQUIRED",
      });
    if (value.mode !== "SPARSE" && value.sparsePaths.length > 0)
      context.addIssue({
        code: "custom",
        path: ["sparsePaths"],
        message: "SPARSE_PATHS_NOT_ALLOWED",
      });
    if (value.mode === "EXTERNAL" && !value.externalWorkspaceRef)
      context.addIssue({
        code: "custom",
        path: ["externalWorkspaceRef"],
        message: "EXTERNAL_WORKSPACE_REQUIRED",
      });
    if (value.mode !== "EXTERNAL" && value.externalWorkspaceRef)
      context.addIssue({
        code: "custom",
        path: ["externalWorkspaceRef"],
        message: "EXTERNAL_WORKSPACE_NOT_ALLOWED",
      });
  });

export const AssignmentInstructionPackageSchema = z.object({
  schemaVersion: z.literal(1),
  journeyId: Id,
  assignmentId: Id,
  participantId: Id,
  worldId: Id,
  direction: z.object({
    revisionId: Id,
    version: z.number().int().positive(),
    contentHash: Hash,
    outcome: z.string().trim().min(1).max(8_000),
    successCriteria: z.array(z.string().trim().min(1).max(2_000)).max(100),
    constraints: z.array(z.string().trim().min(1).max(2_000)).max(100),
    nonGoals: z.array(z.string().trim().min(1).max(2_000)).max(100),
  }),
  objective: z.string().trim().min(1).max(8_000),
  scope: z.array(z.string().trim().min(1).max(1_000)).max(1_000),
  materialisation: SourceMaterialisationSchema,
  contextManifestHash: Hash,
  capabilityActions: z.array(Id).max(200),
  evidenceRequirements: z.array(z.string().trim().min(1).max(2_000)).max(100),
  requiredChecks: z.array(Id).max(100),
  refresh: z.object({
    url: z.url(),
    beforeStart: z.literal(true),
    whileRunningSeconds: z.number().int().min(5).max(300),
    beforeCompletion: z.literal(true),
    onChange: z.literal("STOP_AND_RECONCILE"),
  }),
  compiledAt: Timestamp,
  contentHash: Hash,
});

export const JourneyCapsuleV1Schema = z.object({
  capsuleVersion: z.literal("1.0"),
  journeyId: Id,
  journeyVersion: z.number().int().nonnegative(),
  canonicalThroughSequence: z.number().int().nonnegative(),
  exportedAt: Timestamp,
  direction: AssignmentInstructionPackageSchema.shape.direction,
  assignments: z.array(AssignmentInstructionPackageSchema).max(10_000),
  acceptedContributionRefs: z.array(Id).max(100_000),
  evidenceRefs: z.array(Id).max(100_000),
  decisionRefs: z.array(Id).max(100_000),
  runtimeRequirements: z.array(Id).max(500),
  contentHash: Hash,
});

export type ActorReference = z.infer<typeof ActorReferenceSchema>;
export type AuthorityReference = z.infer<typeof AuthorityReferenceSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type DomainEventEnvelope = z.infer<typeof DomainEventEnvelopeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export type CoordinationRequestPayload = z.infer<
  typeof CoordinationRequestPayloadSchema
>;
export type ContextManifestContract = z.infer<typeof ContextManifestSchema>;
export type AttentionItemView = z.infer<typeof AttentionItemViewSchema>;
export type VerificationSubjectManifestContract = z.infer<
  typeof VerificationSubjectManifestSchema
>;
export type AssuranceFindingContract = z.infer<typeof AssuranceFindingSchema>;
export type AssuranceOutcomeContract = z.infer<typeof AssuranceOutcomeSchema>;
export type DecisionCaseView = z.infer<typeof DecisionCaseViewSchema>;
export type CandidateResolutionView = z.infer<
  typeof CandidateResolutionViewSchema
>;
export type QuickStartAnswersContract = z.infer<typeof QuickStartAnswersSchema>;
export type HarnessDescriptorContract = z.infer<typeof HarnessDescriptorSchema>;
export type ProjectStartRequestContract = z.infer<
  typeof ProjectStartRequestSchema
>;
export type AgentConnectionRequestContract = z.infer<
  typeof AgentConnectionRequestSchema
>;
export type ActivityLayer = z.infer<typeof ActivityLayerSchema>;
export type AgentOperatingScope = z.infer<typeof AgentOperatingScopeSchema>;
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type NativeToolId = z.infer<typeof NativeToolIdSchema>;
export type RuntimeNativeTool = z.infer<typeof RuntimeNativeToolSchema>;
export type RuntimeNativeToolManifest = z.infer<
  typeof RuntimeNativeToolManifestSchema
>;
export type RuntimeNativeToolRequirement = z.infer<
  typeof RuntimeNativeToolRequirementSchema
>;
export type RuntimeNativeToolRequirementSet = z.infer<
  typeof RuntimeNativeToolRequirementSetSchema
>;
export type AgentSetupProfile = z.infer<typeof AgentSetupProfileSchema>;
export type HarnessInventory = z.infer<typeof HarnessInventorySchema>;
export type AgentProfileApproval = z.infer<typeof AgentProfileApprovalSchema>;
export type AgentProfileApprovalRequest = z.infer<
  typeof AgentProfileApprovalRequestSchema
>;
export type AgentProfileBinding = z.infer<typeof AgentProfileBindingSchema>;
export type AgentProfileBindingRequest = z.infer<
  typeof AgentProfileBindingRequestSchema
>;
export type DeliveryBoundary = z.infer<typeof DeliveryBoundarySchema>;
export type DeliveryBoundaryMutation = z.infer<
  typeof DeliveryBoundaryMutationSchema
>;
export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;
export type CredentialReferenceMutation = z.infer<
  typeof CredentialReferenceMutationSchema
>;
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;
export type CapabilityBindingMutation = z.infer<
  typeof CapabilityBindingMutationSchema
>;
export type SourceConnection = z.infer<typeof SourceConnectionSchema>;
export type SourceConnectionMutation = z.infer<
  typeof SourceConnectionMutationSchema
>;
export type ProjectAutonomyPolicy = z.infer<typeof ProjectAutonomyPolicySchema>;
export type ProjectAutonomyPolicyMutation = z.infer<
  typeof ProjectAutonomyPolicyMutationSchema
>;
export type SourceMaterialisation = z.infer<typeof SourceMaterialisationSchema>;
export type AssignmentInstructionPackage = z.infer<
  typeof AssignmentInstructionPackageSchema
>;
export type JourneyCapsuleV1 = z.infer<typeof JourneyCapsuleV1Schema>;
export type ProjectCreateRequestContract = z.infer<
  typeof ProjectCreateRequestSchema
>;
export type ProjectActivityPreviewRequestContract = z.infer<
  typeof ProjectActivityPreviewRequestSchema
>;
export type ProjectJourneyStartRequestContract = z.infer<
  typeof ProjectJourneyStartRequestSchema
>;
export type ProjectAgentConnectionRequestContract = z.infer<
  typeof ProjectAgentConnectionRequestSchema
>;

export interface Clock {
  now(): string;
}
export interface IdGenerator {
  next(prefix: string): string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export async function sha256(value: unknown): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class JentraError extends Error {
  constructor(readonly detail: ApiError) {
    super(detail.messagePlain);
    this.name = "JentraError";
  }
}
