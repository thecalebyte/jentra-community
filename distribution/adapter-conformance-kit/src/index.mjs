const levels = new Set(["GIT_ONLY", "GENERIC_CLI_SDK", "NATIVE_ADAPTER"]);
const genericRequirements = [
  "SCOPED_GIT",
  "RUN_MANIFEST",
  "STRUCTURED_CALLBACKS",
  "IDEMPOTENCY",
  "LEASE_RECOVERY",
  "NO_HUMAN_IMPERSONATION",
];
const nativeRequirements = [
  ...genericRequirements,
  "HOST_REGISTRATION",
  "RESUMABLE_EVENTS",
];

export function requirementsFor(level) {
  if (!levels.has(level))
    throw new TypeError(`Unknown conformance level: ${String(level)}`);
  if (level === "GIT_ONLY") return ["SCOPED_GIT", "NO_HUMAN_IMPERSONATION"];
  if (level === "GENERIC_CLI_SDK") return [...genericRequirements];
  return [...nativeRequirements];
}

export function evaluateHarness(declaration) {
  if (!declaration || typeof declaration !== "object")
    return { conformant: false, errors: ["DECLARATION_REQUIRED"], missing: [] };
  if (!levels.has(declaration.level))
    return { conformant: false, errors: ["UNKNOWN_LEVEL"], missing: [] };
  const capabilities = new Set(
    Array.isArray(declaration.capabilities) ? declaration.capabilities : [],
  );
  const missing = requirementsFor(declaration.level).filter(
    (item) => !capabilities.has(item),
  );
  const errors = [];
  if (declaration.canApproveHumanDecisions === true)
    errors.push("HUMAN_APPROVAL_IMPERSONATION");
  if (declaration.canBroadenCredentials === true)
    errors.push("CREDENTIAL_SCOPE_BYPASS");
  if (declaration.canAuthorizeDeployment === true)
    errors.push("DEPLOYMENT_AUTHORITY_BYPASS");
  return {
    conformant: missing.length === 0 && errors.length === 0,
    errors,
    missing,
  };
}

export const CONFORMANCE_LEVELS = Object.freeze([...levels]);
