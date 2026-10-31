import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateRequiredChecks,
  invalidateCheck,
  runLocalCheck,
  verifyCandidateCheckReceipt,
} from "./index.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function makeRoot(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "jentra-check-"));
  roots.push(value);
  return value;
}
const command = (id: string, source: string, extra: string[] = []) => ({
  id,
  label: id,
  executable: process.execPath,
  args: ["-e", source, ...extra],
  cwd: ".",
  timeoutMs: 5000,
  envAllowlist: [],
});

describe("local verification runner", () => {
  it("verifies provider-neutral retained receipts and rejects inconsistent passes", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "receipt-candidate",
      runner: "EXTERNAL_CI",
      runnerId: "gitlab-ci:100:200",
      policy: {
        version: 1,
        commands: [command("smoke", "")],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(verifyCandidateCheckReceipt(result.check)).toMatchObject({
      candidateHash: "receipt-candidate",
      runner: "EXTERNAL_CI",
      runnerId: "gitlab-ci:100:200",
      status: "PASSED",
    });
    expect(verifyCandidateCheckReceipt(result)).toMatchObject({
      candidateHash: "receipt-candidate",
      runnerId: "gitlab-ci:100:200",
    });
    expect(() =>
      verifyCandidateCheckReceipt({
        ...result.check,
        commandRecords: [
          { ...result.check.commandRecords[0], status: "FAILED" },
        ],
      }),
    ).toThrow("a passing Check contains a non-passing command");
  });
  it("requires fresh candidate, composition and delivery checks before readiness", () => {
    const commandRecord = {
      id: "test",
      label: "Test",
      executable: "node",
      args: [],
      cwd: ".",
      startedAt: "2026-10-28T00:00:00.000Z",
      finishedAt: "2026-10-28T00:00:01.000Z",
      exitCode: 0,
      status: "PASSED" as const,
      stdoutDigest: "out",
      stderrDigest: "err",
      outputTruncated: false,
    };
    const check = (
      stage: "CANDIDATE" | "POST_COMPOSITION" | "PRE_DELIVERY",
    ) => ({
      id: `check-${stage}`,
      candidateHash: "candidate-1",
      dependencyHash: "deps-1",
      directionRevisionId: "direction-1",
      stage,
      runner: "LOCAL" as const,
      runnerId: "local:test",
      environmentFingerprint: "environment",
      policyHash: "policy",
      commandRecords: [commandRecord],
      artifactRefs: [],
      status: "PASSED" as const,
      createdAt: "2026-10-28T00:00:00.000Z",
    });
    const rules = ["CANDIDATE", "POST_COMPOSITION", "PRE_DELIVERY"].map(
      (stage) => ({
        id: stage.toLowerCase(),
        stage: stage as "CANDIDATE" | "POST_COMPOSITION" | "PRE_DELIVERY",
        commandIds: ["test"],
        required: true,
      }),
    );
    const expected = {
      candidateHash: "candidate-1",
      dependencyHash: "deps-1",
      directionRevisionId: "direction-1",
    };
    expect(
      evaluateRequiredChecks(rules, [check("CANDIDATE")], expected),
    ).toMatchObject({
      ready: false,
      missingRuleIds: ["post_composition", "pre_delivery"],
    });
    expect(
      evaluateRequiredChecks(
        rules,
        rules.map((rule) => check(rule.stage)),
        expected,
      ),
    ).toEqual({
      ready: true,
      missingRuleIds: [],
      failedRuleIds: [],
      staleRuleIds: [],
    });
  });
  it("runs an argv-based command and binds the result to the candidate", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "candidate-1",
      policy: {
        version: 1,
        commands: [command("smoke", "console.log('ok')")],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.check.status).toBe("PASSED");
    expect(result.check.candidateHash).toBe("candidate-1");
    expect(result.output.smoke?.stdout).toContain("ok");
  });
  it("does not invoke a shell for metacharacters", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "candidate-1",
      policy: {
        version: 1,
        commands: [
          command("literal", "console.log(process.argv[1])", ["; echo unsafe"]),
        ],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.output.literal?.stdout.trim()).toBe("; echo unsafe");
  });
  it("redacts common inline secret forms", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "candidate-1",
      policy: {
        version: 1,
        commands: [command("redact", "console.log('token=top-secret')")],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.output.redact?.stdout).toContain("token=[REDACTED]");
    expect(result.output.redact?.stdout).not.toContain("top-secret");
  });
  it("invalidates evidence after material input changes", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "a",
      dependencyHash: "d1",
      directionRevisionId: "r1",
      policy: {
        version: 1,
        commands: [command("pass", "")],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(
      invalidateCheck(result.check, {
        candidateHash: "b",
        dependencyHash: "d1",
        directionRevisionId: "r1",
      }).status,
    ).toBe("STALE");
  });
  it("fails closed when network isolation is required but unavailable", async () => {
    await expect(
      runLocalCheck({
        root: await makeRoot(),
        candidateHash: "a",
        policy: {
          version: 1,
          commands: [command("pass", "")],
          maxOutputBytes: 10_000,
          network: "REQUIRE_ISOLATION",
        },
      }),
    ).rejects.toThrow("NETWORK_ISOLATION_UNAVAILABLE");
  });
  it("times out a command and records the boundary", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "a",
      policy: {
        version: 1,
        commands: [
          { ...command("slow", "setTimeout(()=>{}, 5000)"), timeoutMs: 1000 },
        ],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.check.status).toBe("TIMED_OUT");
  }, 10_000);
  it("terminates descendants when a timed-out command owns a process tree", async () => {
    const root = await makeRoot();
    const marker = join(root, "descendant-survived.txt");
    const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'unsafe'),5000)`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setTimeout(()=>{},8000)`;
    const result = await runLocalCheck({
      root,
      candidateHash: "tree-timeout",
      policy: {
        version: 1,
        commands: [{ ...command("tree", parent), timeoutMs: 1000 }],
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.check.status).toBe("TIMED_OUT");
    await wait(5_500);
    await expect(access(marker)).rejects.toThrow();
  }, 15_000);
  it("rejects a working directory outside the Project root", async () => {
    await expect(
      runLocalCheck({
        root: await makeRoot(),
        candidateHash: "a",
        policy: {
          version: 1,
          commands: [{ ...command("escape", ""), cwd: ".." }],
          maxOutputBytes: 10_000,
          network: "INHERIT",
        },
      }),
    ).rejects.toThrow("CHECK_CWD_OUTSIDE_ROOT");
  });
  it("bounds retained output and marks truncation", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "a",
      policy: {
        version: 1,
        commands: [command("large", "console.log('x'.repeat(5000))")],
        maxOutputBytes: 1024,
        network: "INHERIT",
      },
    });
    expect(
      Buffer.byteLength(result.output.large?.stdout ?? ""),
    ).toBeLessThanOrEqual(1024);
    expect(result.check.commandRecords[0]?.outputTruncated).toBe(true);
  });
  it("runs a dependency graph, blocks descendants, and preserves independent work", async () => {
    const result = await runLocalCheck({
      root: await makeRoot(),
      candidateHash: "graph",
      policy: {
        version: 1,
        commands: [
          command("fails", "process.exit(2)"),
          {
            ...command("blocked", "throw new Error('must not run')"),
            dependsOn: ["fails"],
          },
          command("independent", "console.log('still ran')"),
        ],
        maxConcurrency: 2,
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.check.status).toBe("FAILED");
    expect(
      result.check.commandRecords.find((item) => item.id === "blocked")?.status,
    ).toBe("BLOCKED");
    expect(result.output.independent?.stdout).toContain("still ran");
  });
  it("records bounded artifact digests without copying project content", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "report.json"), '{"passed":true}');
    const result = await runLocalCheck({
      root,
      candidateHash: "artifact",
      policy: {
        version: 1,
        commands: [{ ...command("report", ""), artifacts: ["report.json"] }],
        maxArtifactBytes: 1_024,
        maxOutputBytes: 10_000,
        network: "INHERIT",
      },
    });
    expect(result.check.artifactRefs[0]).toMatch(
      /^sha256:[a-f0-9]{64}:report\.json$/u,
    );
  });
  it("rejects unknown dependency edges", async () => {
    await expect(
      runLocalCheck({
        root: await makeRoot(),
        candidateHash: "bad-graph",
        policy: {
          version: 1,
          commands: [{ ...command("test", ""), dependsOn: ["missing"] }],
          maxOutputBytes: 10_000,
          network: "INHERIT",
        },
      }),
    ).rejects.toThrow("CHECK_UNKNOWN_DEPENDENCY");
  });
});
