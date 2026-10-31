import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

export type CheckStage = "CANDIDATE" | "POST_COMPOSITION" | "PRE_DELIVERY";
export type CheckStatus =
  | "QUEUED"
  | "RUNNING"
  | "PASSED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "STALE"
  | "BLOCKED";
export interface CheckCommandRecord {
  id: string;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  startedAt: string;
  finishedAt?: string | undefined;
  exitCode?: number | undefined;
  signal?: string | undefined;
  status: Exclude<CheckStatus, "QUEUED" | "STALE">;
  stdoutDigest: string;
  stderrDigest: string;
  outputTruncated: boolean;
}
export interface CandidateCheck {
  id: string;
  journeyId?: string | undefined;
  contributionId?: string | undefined;
  candidateHash: string;
  baseRef?: string | undefined;
  dependencyHash?: string | undefined;
  directionRevisionId?: string | undefined;
  directionRevisionVersion?: number | undefined;
  stage: CheckStage;
  runner: "LOCAL" | "USER_OWNED" | "EXTERNAL_CI";
  runnerId: string;
  environmentFingerprint: string;
  policyHash: string;
  commandRecords: CheckCommandRecord[];
  artifactRefs: string[];
  status: CheckStatus;
  createdAt: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  invalidatedAt?: string | undefined;
  invalidationReason?: string | undefined;
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const checkStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "STALE",
  "BLOCKED",
]);
const commandRecordSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  executable: z.string().min(1).max(260),
  args: z.array(z.string().max(2000)).max(128),
  cwd: z.string().max(500),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
  status: checkStatusSchema.exclude(["QUEUED", "STALE"]),
  stdoutDigest: digestSchema,
  stderrDigest: digestSchema,
  outputTruncated: z.boolean(),
});

export const candidateCheckSchema = z.object({
  id: z.string().min(1).max(160),
  journeyId: z.string().min(1).max(160).optional(),
  contributionId: z.string().min(1).max(160).optional(),
  candidateHash: z.string().min(1).max(512),
  baseRef: z.string().min(1).max(512).optional(),
  dependencyHash: z.string().min(1).max(512).optional(),
  directionRevisionId: z.string().min(1).max(160).optional(),
  directionRevisionVersion: z.number().int().positive().optional(),
  stage: z.enum(["CANDIDATE", "POST_COMPOSITION", "PRE_DELIVERY"]),
  runner: z.enum(["LOCAL", "USER_OWNED", "EXTERNAL_CI"]),
  runnerId: z.string().min(1).max(500),
  environmentFingerprint: digestSchema,
  policyHash: digestSchema,
  commandRecords: z.array(commandRecordSchema).max(64),
  artifactRefs: z.array(z.string().min(1).max(1000)).max(256),
  status: checkStatusSchema,
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
  invalidatedAt: timestampSchema.optional(),
  invalidationReason: z.string().min(1).max(1000).optional(),
});

export function verifyCandidateCheckReceipt(input: unknown): CandidateCheck {
  const wrapped = z.object({ check: z.unknown() }).safeParse(input);
  const check = candidateCheckSchema.parse(
    wrapped.success ? wrapped.data.check : input,
  );
  if (
    check.status === "PASSED" &&
    check.commandRecords.some((item) => item.status !== "PASSED")
  )
    throw new Error(
      "CHECK_RECEIPT_INCONSISTENT: a passing Check contains a non-passing command.",
    );
  if (
    check.status === "STALE" &&
    (!check.invalidatedAt || !check.invalidationReason)
  )
    throw new Error(
      "CHECK_RECEIPT_INCONSISTENT: a stale Check requires invalidation evidence.",
    );
  if (check.finishedAt && check.startedAt && check.finishedAt < check.startedAt)
    throw new Error(
      "CHECK_RECEIPT_INCONSISTENT: the Check finishes before it starts.",
    );
  for (const command of check.commandRecords)
    if (command.finishedAt && command.finishedAt < command.startedAt)
      throw new Error(
        `CHECK_RECEIPT_INCONSISTENT: command ${command.id} finishes before it starts.`,
      );
  return check;
}

const commandSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u),
  label: z.string().min(1).max(120),
  executable: z.string().min(1).max(260),
  args: z.array(z.string().max(2000)).max(128).default([]),
  cwd: z.string().max(500).default("."),
  timeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  envAllowlist: z
    .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/u))
    .max(64)
    .default([]),
  dependsOn: z.array(z.string().min(1).max(80)).max(32).default([]),
  artifacts: z.array(z.string().min(1).max(500)).max(32).default([]),
});

export const localCheckPolicySchema = z.object({
  version: z.literal(1),
  commands: z.array(commandSchema).min(1).max(64),
  maxOutputBytes: z.number().int().min(1024).max(10_000_000).default(1_000_000),
  network: z.enum(["INHERIT", "REQUIRE_ISOLATION"]).default("INHERIT"),
  maxConcurrency: z.number().int().min(1).max(16).default(4),
  maxArtifactBytes: z
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .default(10_000_000),
});

export type LocalCheckPolicy = z.input<typeof localCheckPolicySchema>;

export interface LocalCheckRequest {
  root: string;
  candidateHash: string;
  baseRef?: string;
  dependencyHash?: string;
  journeyId?: string;
  contributionId?: string;
  directionRevisionId?: string;
  directionRevisionVersion?: number;
  stage?: CheckStage;
  runner?: CandidateCheck["runner"];
  runnerId?: string;
  policy: LocalCheckPolicy;
  signal?: AbortSignal;
  onOutput?: (event: {
    commandId: string;
    stream: "stdout" | "stderr";
    chunk: string;
  }) => void;
}

export interface LocalCheckResult {
  check: CandidateCheck;
  output: Record<string, { stdout: string; stderr: string }>;
}

export interface RequiredCheckRule {
  id: string;
  stage: CheckStage;
  commandIds: string[];
  required: boolean;
}

export interface RequiredCheckEvaluation {
  ready: boolean;
  missingRuleIds: string[];
  failedRuleIds: string[];
  staleRuleIds: string[];
}

export function evaluateRequiredChecks(
  rules: RequiredCheckRule[],
  checks: CandidateCheck[],
  expected: {
    candidateHash: string;
    dependencyHash?: string;
    directionRevisionId?: string;
  },
): RequiredCheckEvaluation {
  const missingRuleIds: string[] = [];
  const failedRuleIds: string[] = [];
  const staleRuleIds: string[] = [];
  for (const rule of rules.filter((item) => item.required)) {
    const eligible = checks.filter(
      (check) =>
        check.stage === rule.stage &&
        rule.commandIds.every((id) =>
          check.commandRecords.some((record) => record.id === id),
        ),
    );
    if (eligible.length === 0) {
      missingRuleIds.push(rule.id);
      continue;
    }
    const fresh = eligible.find(
      (check) =>
        check.candidateHash === expected.candidateHash &&
        check.dependencyHash === expected.dependencyHash &&
        check.directionRevisionId === expected.directionRevisionId,
    );
    if (!fresh) {
      staleRuleIds.push(rule.id);
      continue;
    }
    if (fresh.status !== "PASSED") failedRuleIds.push(rule.id);
  }
  return {
    ready:
      missingRuleIds.length === 0 &&
      failedRuleIds.length === 0 &&
      staleRuleIds.length === 0,
    missingRuleIds,
    failedRuleIds,
    staleRuleIds,
  };
}

const sensitiveName =
  /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)/iu;
const inlineSecret =
  /\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*([^\s,;]+)/giu;

export async function runLocalCheck(
  input: LocalCheckRequest,
): Promise<LocalCheckResult> {
  const policy = localCheckPolicySchema.parse(input.policy);
  if (policy.network === "REQUIRE_ISOLATION") {
    throw new Error(
      "NETWORK_ISOLATION_UNAVAILABLE: use an eligible sandboxed runner.",
    );
  }
  const root = await realpath(resolve(input.root));
  const now = new Date().toISOString();
  const check: CandidateCheck = {
    id: `check-${randomUUID()}`,
    ...(input.journeyId ? { journeyId: input.journeyId } : {}),
    ...(input.contributionId ? { contributionId: input.contributionId } : {}),
    candidateHash: input.candidateHash,
    ...(input.baseRef ? { baseRef: input.baseRef } : {}),
    ...(input.dependencyHash ? { dependencyHash: input.dependencyHash } : {}),
    ...(input.directionRevisionId
      ? { directionRevisionId: input.directionRevisionId }
      : {}),
    ...(input.directionRevisionVersion !== undefined
      ? { directionRevisionVersion: input.directionRevisionVersion }
      : {}),
    stage: input.stage ?? "CANDIDATE",
    runner: input.runner ?? "LOCAL",
    runnerId: input.runnerId ?? `local:${platform()}:${arch()}`,
    environmentFingerprint: digestJson({
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.version,
    }),
    policyHash: digestJson(policy),
    commandRecords: [],
    artifactRefs: [],
    status: "RUNNING",
    createdAt: now,
    startedAt: now,
  };
  const output: LocalCheckResult["output"] = {};
  validateGraph(policy.commands);
  const pending = new Map(
    policy.commands.map((command) => [command.id, command]),
  );
  const completed = new Map<string, CheckCommandRecord>();
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((command) =>
      command.dependsOn.every((dependency) => completed.has(dependency)),
    );
    if (ready.length === 0)
      throw new Error(
        "CHECK_GRAPH_CYCLE: command dependencies contain a cycle.",
      );
    for (let index = 0; index < ready.length; index += policy.maxConcurrency) {
      const batch = ready.slice(index, index + policy.maxConcurrency);
      const results = await Promise.all(
        batch.map(async (command) => {
          const dependencyFailed = command.dependsOn.some(
            (dependency) => completed.get(dependency)?.status !== "PASSED",
          );
          return dependencyFailed
            ? blockedCommand(command)
            : executeCommand(
                root,
                command,
                policy.maxOutputBytes,
                input.signal,
                input.onOutput,
              );
        }),
      );
      for (
        let resultIndex = 0;
        resultIndex < results.length;
        resultIndex += 1
      ) {
        const command = batch[resultIndex]!;
        const result = results[resultIndex]!;
        check.commandRecords.push(result.record);
        output[command.id] = result.output;
        completed.set(command.id, result.record);
        pending.delete(command.id);
        for (const artifact of command.artifacts) {
          const ref = await artifactRef(
            root,
            artifact,
            policy.maxArtifactBytes,
          );
          if (ref && !check.artifactRefs.includes(ref))
            check.artifactRefs.push(ref);
        }
      }
    }
  }
  const failed = check.commandRecords.find((record) =>
    ["FAILED", "CANCELLED", "TIMED_OUT"].includes(record.status),
  );
  check.status =
    failed?.status ??
    (check.commandRecords.some((record) => record.status === "BLOCKED")
      ? "BLOCKED"
      : "PASSED");
  check.finishedAt = new Date().toISOString();
  return { check, output };
}

export function invalidateCheck(
  check: CandidateCheck,
  current: {
    candidateHash: string;
    dependencyHash?: string;
    directionRevisionId?: string;
  },
  now = new Date().toISOString(),
): CandidateCheck {
  const reasons = [
    check.candidateHash !== current.candidateHash
      ? "candidate changed"
      : undefined,
    check.dependencyHash !== current.dependencyHash
      ? "dependencies changed"
      : undefined,
    check.directionRevisionId !== current.directionRevisionId
      ? "Direction changed"
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return reasons.length === 0
    ? check
    : {
        ...check,
        status: "STALE",
        invalidatedAt: now,
        invalidationReason: reasons.join(", "),
      };
}

async function executeCommand(
  root: string,
  command: z.infer<typeof commandSchema>,
  maxOutputBytes: number,
  signal?: AbortSignal,
  onOutput?: LocalCheckRequest["onOutput"],
): Promise<{
  record: CheckCommandRecord;
  output: { stdout: string; stderr: string };
}> {
  const cwd = await confinedPath(root, command.cwd);
  const startedAt = new Date().toISOString();
  const inheritedEnv = Object.fromEntries(
    command.envAllowlist
      .filter(
        (name) => !sensitiveName.test(name) && process.env[name] !== undefined,
      )
      .map((name) => [name, process.env[name]!]),
  );
  const safeEnv = {
    ...inheritedEnv,
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    CI: "1",
    JENTRA_CHECK: "1",
  };
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const execution = { timedOut: false };
  const child = spawn(command.executable, command.args, {
    cwd,
    env: safeEnv,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let termination: Promise<void> | undefined;
  const terminate = () => {
    termination ??= terminateProcessTree(child.pid);
    return termination;
  };
  const timer = setTimeout(() => {
    execution.timedOut = true;
    void terminate();
  }, command.timeoutMs);
  const abort = () => {
    void terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
    const safe = redact(chunk.toString("utf8"));
    const previous = stream === "stdout" ? stdout : stderr;
    const remaining = Math.max(0, maxOutputBytes - Buffer.byteLength(previous));
    const next = Buffer.from(safe).subarray(0, remaining).toString("utf8");
    if (Buffer.byteLength(safe) > remaining) truncated = true;
    if (stream === "stdout") stdout += next;
    else stderr += next;
    if (next) onOutput?.({ commandId: command.id, stream, chunk: next });
  };
  child.stdout.on("data", (chunk: Buffer) => {
    capture("stdout", chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    capture("stderr", chunk);
  });
  const completion = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code, closeSignal) => {
      resolvePromise({ code, signal: closeSignal });
    });
  }).finally(async () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await termination;
  });
  const status = execution.timedOut
    ? "TIMED_OUT"
    : signal?.aborted
      ? "CANCELLED"
      : completion.code === 0
        ? "PASSED"
        : "FAILED";
  return {
    record: {
      id: command.id,
      label: command.label,
      executable: command.executable,
      args: command.args,
      cwd: relative(root, cwd) || ".",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(completion.code !== null ? { exitCode: completion.code } : {}),
      ...(completion.signal ? { signal: completion.signal } : {}),
      status,
      stdoutDigest: digest(stdout),
      stderrDigest: digest(stderr),
      outputTruncated: truncated,
    },
    output: { stdout, stderr },
  };
}

function validateGraph(commands: z.infer<typeof commandSchema>[]): void {
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id))
      throw new Error(`CHECK_DUPLICATE_COMMAND: ${command.id}`);
    ids.add(command.id);
  }
  for (const command of commands)
    for (const dependency of command.dependsOn)
      if (!ids.has(dependency))
        throw new Error(
          `CHECK_UNKNOWN_DEPENDENCY: ${command.id} depends on ${dependency}`,
        );
}

function blockedCommand(command: z.infer<typeof commandSchema>): {
  record: CheckCommandRecord;
  output: { stdout: string; stderr: string };
} {
  const now = new Date().toISOString();
  return {
    record: {
      id: command.id,
      label: command.label,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      startedAt: now,
      finishedAt: now,
      status: "BLOCKED",
      stdoutDigest: digest(""),
      stderrDigest: digest("Blocked by a failed dependency."),
      outputTruncated: false,
    },
    output: { stdout: "", stderr: "Blocked by a failed dependency." },
  };
}

async function artifactRef(
  root: string,
  path: string,
  maxBytes: number,
): Promise<string | undefined> {
  const absolute = await confinedPath(root, path);
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new Error(`CHECK_ARTIFACT_NOT_FILE: ${path}`);
  if (metadata.size > maxBytes)
    throw new Error(`CHECK_ARTIFACT_TOO_LARGE: ${path}`);
  return `sha256:${digest(await readFile(absolute))}:${relative(root, absolute).replaceAll("\\", "/")}`;
}

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolvePromise) => {
      const script =
        `$root=${String(pid)};` +
        "$all=@(Get-CimInstance Win32_Process);$ids=@($root);" +
        "do{$before=$ids.Count;$children=@($all|Where-Object{$ids -contains [int]$_.ParentProcessId}|ForEach-Object{[int]$_.ProcessId});$ids=@($ids+$children|Select-Object -Unique)}while($ids.Count -gt $before);" +
        "$ids|Sort-Object -Descending|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}";
      const killer = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      killer.once("close", () => {
        resolvePromise();
      });
      killer.once("error", () => {
        resolvePromise();
      });
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The process group exited during the grace period.
      }
    }, 2_000).unref();
  } catch {
    // The process group already exited.
  }
}

async function confinedPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path))
    throw new Error("CHECK_CWD_OUTSIDE_ROOT: absolute paths are not allowed.");
  const candidate = await realpath(resolve(root, path));
  const back = relative(root, candidate);
  if (back.startsWith("..") || isAbsolute(back))
    throw new Error(
      "CHECK_CWD_OUTSIDE_ROOT: command path escapes the Project root.",
    );
  return candidate;
}

function redact(value: string): string {
  return value.replace(
    inlineSecret,
    (_match, name: string) => `${name}=[REDACTED]`,
  );
}
function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function digestJson(value: unknown): string {
  return digest(JSON.stringify(value));
}
