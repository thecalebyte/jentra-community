#!/usr/bin/env node
import { JentraApiError, JentraClient } from "@jentra/sdk";
import {
  JourneyCapsuleV1Schema,
  sha256,
  type CommandEnvelope,
} from "@jentra/contracts";
import {
  localCheckPolicySchema,
  runLocalCheck,
  verifyCandidateCheckReceipt,
} from "@jentra/local-runner";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const VERSION = (
  JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  }
).version;
class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
void main().catch((error: unknown) => {
  const json = process.argv.includes("--json");
  const value =
    error instanceof JentraApiError
      ? {
          error: {
            code: error.code,
            message: error.message,
            status: error.status,
            retryClass: error.retryClass,
            remediationActions: error.remediationActions,
            correlationId: error.correlationId,
            ...(error.targetRef ? { targetRef: error.targetRef } : {}),
            ...(error.currentVersion !== undefined
              ? { currentVersion: error.currentVersion }
              : {}),
          },
        }
      : error instanceof CliError
        ? {
            error: {
              code: error.code,
              message: error.message,
              retryClass: "USER_ACTION",
              remediationActions: [
                "Configure a Jentra session or development identity.",
              ],
              correlationId: "unavailable",
            },
          }
        : {
            error: {
              code: "CLI_ERROR",
              message:
                error instanceof Error ? error.message : "Jentra CLI failed.",
              retryClass: "NEVER",
              remediationActions: [],
              correlationId: "unavailable",
            },
          };
  console.error(
    json
      ? JSON.stringify(value)
      : `${value.error.code}: ${value.error.message}`,
  );
  process.exitCode = error instanceof JentraApiError ? 4 : 3;
});

async function main(): Promise<void> {
  const [command, journeyId, worldId, retentionMode] = process.argv.slice(2);
  const baseUrl = process.env.JENTRA_API_URL ?? "http://127.0.0.1:8787";
  const client = new JentraClient(baseUrl, {
    authenticationHeaders: async () => authenticationHeaders(),
  });
  if (command === "--version" || command === "version") {
    console.log(VERSION);
  } else if (command === "--help" || command === "help") {
    console.log(usage());
  } else if (command === "capsule" && journeyId === "export") {
    const capsuleJourneyId = worldId;
    if (!capsuleJourneyId)
      throw new CliError(
        "CAPSULE_JOURNEY_REQUIRED",
        "Use jentra capsule export <journey-id> [--output <file>].",
      );
    const capsule = await client.journeyCapsule(capsuleJourneyId);
    const target = resolve(
      option("--output") ??
        `jentra-${capsuleJourneyId}-capsule-v${capsule.capsuleVersion}.json`,
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(capsule, null, 2)}\n`, "utf8");
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify({
            journeyId: capsule.journeyId,
            contentHash: capsule.contentHash,
            target,
          })
        : `Exported Journey Capsule v${capsule.capsuleVersion} to ${target}`,
    );
  } else if (command === "capsule" && journeyId === "verify") {
    const capsulePath = worldId;
    if (!capsulePath)
      throw new CliError(
        "CAPSULE_PATH_REQUIRED",
        "Use jentra capsule verify <file>.",
      );
    const capsule = JourneyCapsuleV1Schema.parse(
      JSON.parse(await readFile(resolve(capsulePath), "utf8")),
    );
    const { contentHash, ...unsigned } = capsule;
    if ((await sha256(unsigned)) !== contentHash)
      throw new CliError(
        "CAPSULE_CONTENT_HASH_MISMATCH",
        "The Capsule content hash is invalid.",
      );
    for (const instruction of capsule.assignments) {
      const { contentHash: instructionHash, ...instructionUnsigned } =
        instruction;
      if ((await sha256(instructionUnsigned)) !== instructionHash)
        throw new CliError(
          "CAPSULE_INSTRUCTION_HASH_MISMATCH",
          `Instruction ${instruction.assignmentId} has an invalid content hash.`,
        );
    }
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify({
            valid: true,
            journeyId: capsule.journeyId,
            contentHash,
          })
        : `Valid Journey Capsule v${capsule.capsuleVersion}: ${capsule.journeyId}`,
    );
  } else if (command === "check" && journeyId === "init-ci") {
    const root = resolve(option("--root") ?? process.cwd());
    const provider = option("--provider") ?? "github";
    const definition = ciProvider(provider);
    const target = definition ? resolve(root, definition.path) : undefined;
    if (!target)
      throw new CliError(
        "CI_PROVIDER_UNSUPPORTED",
        "Use --provider github, gitlab, circleci, buildkite, azure, or cloudflare.",
      );
    try {
      await readFile(target, "utf8");
      if (!process.argv.includes("--force"))
        throw new CliError(
          "CI_CONFIGURATION_EXISTS",
          `${target} already exists. Review it or use --force to replace it.`,
        );
    } catch (error) {
      if (error instanceof CliError) throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, definition!.content, "utf8");
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify({ provider, target })
        : `Created ${target}`,
    );
  } else if (command === "check" && journeyId === "verify-receipt") {
    if (!worldId)
      throw new CliError(
        "CHECK_RECEIPT_PATH_REQUIRED",
        "Use jentra check verify-receipt <file> [--json].",
      );
    const check = verifyCandidateCheckReceipt(
      JSON.parse(await readFile(resolve(worldId), "utf8")) as unknown,
    );
    const verification = {
      valid: true,
      checkId: check.id,
      candidateHash: check.candidateHash,
      stage: check.stage,
      runner: check.runner,
      runnerId: check.runnerId,
      status: check.status,
      commands: check.commandRecords.length,
      artifacts: check.artifactRefs.length,
    };
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(verification)
        : `Valid ${check.runner} Check receipt ${check.id}: ${check.status} for ${check.candidateHash}`,
    );
  } else if (command === "check" && journeyId === "local") {
    const root = resolve(option("--root") ?? process.cwd());
    const configPath = resolve(
      root,
      option("--config") ?? "jentra.checks.json",
    );
    const candidateHash = option("--candidate");
    if (!candidateHash)
      throw new CliError(
        "CANDIDATE_REQUIRED",
        "Use --candidate with the exact commit, tree, or content hash being checked.",
      );
    const policy = localCheckPolicySchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );
    const controller = new AbortController();
    const cancel = () => {
      controller.abort();
    };
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const baseRef = option("--base");
      const dependencyHash = option("--dependencies");
      const targetJourney = option("--journey");
      const contributionId = option("--contribution");
      const directionRevisionId = option("--direction");
      const directionVersion = option("--direction-version");
      const runnerId = option("--runner-id");
      const optional = {
        ...(baseRef ? { baseRef } : {}),
        ...(dependencyHash ? { dependencyHash } : {}),
        ...(targetJourney ? { journeyId: targetJourney } : {}),
        ...(contributionId ? { contributionId } : {}),
        ...(directionRevisionId ? { directionRevisionId } : {}),
        ...(directionVersion
          ? { directionRevisionVersion: Number(directionVersion) }
          : {}),
      };
      const result = await runLocalCheck({
        root,
        candidateHash,
        ...optional,
        stage:
          (option("--stage") as
            "CANDIDATE" | "POST_COMPOSITION" | "PRE_DELIVERY" | undefined) ??
          "CANDIDATE",
        runner: parseRunner(option("--runner")),
        ...(runnerId ? { runnerId } : {}),
        policy,
        signal: controller.signal,
        ...(process.argv.includes("--json")
          ? {}
          : {
              onOutput: ({
                stream,
                chunk,
              }: {
                stream: "stdout" | "stderr";
                chunk: string;
              }) => {
                (stream === "stdout" ? process.stdout : process.stderr).write(
                  chunk,
                );
              },
            }),
      });
      const outputPath = resolve(
        root,
        option("--output") ?? ".jentra/check-result.json",
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
        encoding: "utf8",
        flag: "w",
      });
      if (process.argv.includes("--upload-artifacts")) {
        for (const reference of result.check.artifactRefs) {
          const match = /^sha256:([a-f0-9]{64}):(.+)$/u.exec(reference);
          if (!match?.[1] || !match[2]) continue;
          await client.uploadArtifact(
            match[1],
            new Uint8Array(await readFile(resolve(root, match[2]))),
          );
        }
      }
      if (process.argv.includes("--upload")) {
        const targetJourneyId = result.check.journeyId;
        if (!targetJourneyId)
          throw new CliError(
            "JOURNEY_REQUIRED",
            "Use --journey when uploading a Check receipt.",
          );
        const snapshot = (await client.journey(targetJourneyId)) as {
          state: { version: number };
        };
        const payload = { ...result.check, checkId: result.check.id };
        const receiptId = crypto.randomUUID();
        await client.command({
          commandId: `cli-check-${receiptId}`,
          commandType: "RecordCandidateCheck",
          schemaVersion: 1,
          journeyId: targetJourneyId,
          aggregateVersionExpected: snapshot.state.version,
          actor: {
            participantId: "authenticated-cli-user",
            clientSessionId: `cli-${receiptId}`,
          },
          authority: {
            roleBindingId: "role-owner",
            capabilityGrantIds: ["grant-owner"],
          },
          policySnapshotId: "policy-guided-balanced-v1",
          correlationId: `cli-check-${receiptId}`,
          idempotencyKey: `cli-check-${result.check.id}`,
          receivedAt: new Date().toISOString(),
          payload,
          payloadHash: await sha256(payload),
        });
      }
      if (process.argv.includes("--json")) console.log(JSON.stringify(result));
      else
        console.log(`\nCheck ${result.check.status}. Receipt: ${outputPath}`);
      if (result.check.status !== "PASSED") process.exitCode = 5;
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  } else if (command === "journey" && journeyId) {
    const result = await client.journey(journeyId);
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(result)
        : `Journey ${journeyId}\n${JSON.stringify(result, null, 2)}`,
    );
  } else if ((command === "direction" || command === "goals") && journeyId) {
    const result = await client.directions(journeyId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "project" && journeyId) {
    const result = await client.project(journeyId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "collaboration" && journeyId) {
    const result = await client.projectCollaboration(journeyId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "people" && journeyId) {
    const result = worldId
      ? await client.journeyPeopleAndAgents(worldId)
      : await client.projectPeopleAndAgents(journeyId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "change-review" && journeyId) {
    const result = await client.changeReview(journeyId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "attention" && journeyId) {
    const result = await client.attention(
      journeyId,
      process.argv.includes("--advanced") ? "advanced" : "guided",
    );
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(result)
        : JSON.stringify(result, null, 2),
    );
  } else if (command === "assurance" && journeyId) {
    const result = await client.assurance(
      journeyId,
      process.argv.includes("--advanced") ? "advanced" : "guided",
    );
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(result)
        : JSON.stringify(result, null, 2),
    );
  } else if (
    (command === "decisions" || command === "resolution") &&
    journeyId
  ) {
    const mode = process.argv.includes("--advanced") ? "advanced" : "guided";
    const result =
      command === "decisions"
        ? await client.decisions(journeyId, mode)
        : await client.resolution(journeyId, mode);
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(result)
        : JSON.stringify(result, null, 2),
    );
  } else if (command === "experience" && journeyId) {
    const mode = process.argv.includes("--advanced")
      ? "advanced"
      : process.argv.includes("--standard")
        ? "standard"
        : "guided";
    const result = await client.experience(journeyId, mode);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "why" && journeyId && worldId) {
    const mode = process.argv.includes("--advanced")
      ? "advanced"
      : process.argv.includes("--standard")
        ? "standard"
        : "guided";
    const result = await client.why(journeyId, worldId, mode);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "memory" && journeyId === "list") {
    const result = await client.memories({
      includeDeleted: process.argv.includes("--deleted"),
    });
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "memory" && journeyId === "get" && worldId) {
    const result = await client.memory(worldId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "memory" && journeyId === "forget" && worldId) {
    const result = await client.forgetMemory(worldId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "memory" && journeyId === "purge" && worldId) {
    const result = await client.purgeMemory(worldId);
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (command === "memory" && journeyId === "export") {
    const result = await client.exportMemories();
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (
    command === "memory" &&
    journeyId === "remember" &&
    worldId &&
    retentionMode
  ) {
    const now = new Date().toISOString();
    const result = await client.writeMemory({
      memoryId: worldId,
      sourceEnvelopeId: `cli-source-${crypto.randomUUID()}`,
      origin: "USER_STATEMENT",
      sourceRef: "jentra-cli:explicit-user-entry",
      sourceHash: await sha256(retentionMode),
      independentSourceId: `cli-entry-${worldId}`,
      memoryClass: "PERSONAL",
      summary: retentionMode,
      content: retentionMode,
      confidence: 1,
      validFrom: now,
    });
    console.log(
      JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2),
    );
  } else if (
    command === "retention" &&
    journeyId &&
    worldId &&
    retentionMode &&
    ["KEEP", "ARCHIVE", "CLEAN_UP_AFTER_REVIEW", "DISPOSABLE"].includes(
      retentionMode,
    )
  ) {
    const snapshot = (await client.journey(journeyId)) as {
      state: { version: number };
    };
    const payload = { worldId, retentionMode };
    const id = crypto.randomUUID();
    const envelope: CommandEnvelope = {
      commandId: `cli-${id}`,
      commandType: "SetWorldRetention",
      schemaVersion: 1,
      journeyId,
      aggregateVersionExpected: snapshot.state.version,
      actor: {
        participantId: "authenticated-cli-user",
        clientSessionId: `cli-${id}`,
      },
      authority: {
        roleBindingId: "role-owner",
        capabilityGrantIds: ["grant-owner"],
      },
      policySnapshotId: "policy-guided-balanced-v1",
      correlationId: `cli-${id}`,
      idempotencyKey: `cli-retention-${id}`,
      receivedAt: new Date().toISOString(),
      payload,
      payloadHash: await sha256(payload),
    };
    const result = await client.command(envelope);
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(result)
        : `World ${worldId} retention set to ${retentionMode}.`,
    );
  } else {
    console.error(usage());
    process.exitCode = 2;
  }
}

function usage(): string {
  return "Usage:\n  jentra check local --candidate <hash> [--root <path>] [--config <file>] [--output <file>] [--runner <local|user-owned|external-ci>] [--runner-id <id>] [--journey <id> --upload] [--upload-artifacts] [--direction <id>] [--json]\n  jentra check verify-receipt <file> [--json]\n  jentra check init-ci --provider <github|gitlab|circleci|buildkite|azure|cloudflare> [--root <path>] [--force]\n  jentra capsule export <journey-id> [--output <file>] [--json]\n  jentra capsule verify <file> [--json]\n  jentra project <project-id> [--json]\n  jentra collaboration <project-id> [--json]\n  jentra people <project-id> [journey-id] [--json]\n  jentra journey <journey-id> [--json]\n  jentra direction <journey-id> [--json]\n  jentra change-review <journey-id> [--json]\n  jentra experience <journey-id> [--standard|--advanced] [--json]\n  jentra why <journey-id> <commit-or-ref> [--standard|--advanced] [--json]\n  jentra attention <journey-id> [--advanced] [--json]\n  jentra assurance <journey-id> [--advanced] [--json]\n  jentra decisions <journey-id> [--advanced] [--json]\n  jentra resolution <journey-id> [--advanced] [--json]\n  jentra retention <journey-id> <world-id> <KEEP|ARCHIVE|CLEAN_UP_AFTER_REVIEW|DISPOSABLE> [--json]\n  jentra memory list [--deleted] [--json]\n  jentra memory get <memory-id> [--json]\n  jentra memory remember <memory-id> <summary> [--json]\n  jentra memory forget <memory-id> [--json]\n  jentra memory purge <memory-id> [--json]\n  jentra memory export [--json]\n  jentra --help\n  jentra --version";
}

function ciProvider(
  provider: string,
): { path: string; content: string } | undefined {
  const providers: Record<string, { path: string; content: string }> = {
    github: {
      path: ".github/workflows/jentra-checks.yml",
      content: githubWorkflow(),
    },
    gitlab: { path: ".gitlab-ci.yml", content: gitlabWorkflow() },
    circleci: { path: ".circleci/config.yml", content: circleCiWorkflow() },
    buildkite: {
      path: ".buildkite/pipeline.yml",
      content: buildkiteWorkflow(),
    },
    azure: { path: "azure-pipelines.jentra.yml", content: azureWorkflow() },
    cloudflare: {
      path: ".cloudflare/jentra-checks.sh",
      content: cloudflareBuildCommand(),
    },
  };
  return providers[provider];
}

function parseRunner(
  value: string | undefined,
): "LOCAL" | "USER_OWNED" | "EXTERNAL_CI" {
  if (value === undefined || value.toLowerCase() === "local") return "LOCAL";
  if (value.toLowerCase() === "user-owned") return "USER_OWNED";
  if (value.toLowerCase() === "external-ci") return "EXTERNAL_CI";
  throw new CliError(
    "CHECK_RUNNER_INVALID",
    "Use --runner local, user-owned, or external-ci.",
  );
}

function githubWorkflow(): string {
  return `name: Jentra Checks\non:\n  pull_request:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: 24\n          cache: npm\n      - run: npm ci\n      - run: npx jentra check local --candidate "\${GITHUB_SHA}" --runner external-ci --runner-id "github-actions:\${GITHUB_RUN_ID}:\${GITHUB_RUN_ATTEMPT}" --output .jentra/check-result.json --json\n      - uses: actions/upload-artifact@v5\n        if: always()\n        with:\n          name: jentra-check-receipt\n          path: .jentra/check-result.json\n`;
}

function gitlabWorkflow(): string {
  return `stages: [verify]\njentra-checks:\n  stage: verify\n  image: node:24\n  script:\n    - npm ci\n    - npx jentra check local --candidate "$CI_COMMIT_SHA" --runner external-ci --runner-id "gitlab-ci:$CI_PIPELINE_ID:$CI_JOB_ID" --output .jentra/check-result.json --json\n  artifacts:\n    when: always\n    paths:\n      - .jentra/check-result.json\n`;
}

function circleCiWorkflow(): string {
  return `version: 2.1\njobs:\n  jentra-checks:\n    docker:\n      - image: cimg/node:24.0\n    steps:\n      - checkout\n      - run: npm ci\n      - run: npx jentra check local --candidate "$CIRCLE_SHA1" --runner external-ci --runner-id "circleci:$CIRCLE_WORKFLOW_ID:$CIRCLE_BUILD_NUM" --output .jentra/check-result.json --json\n      - store_artifacts:\n          path: .jentra/check-result.json\nworkflows:\n  verify:\n    jobs: [jentra-checks]\n`;
}

function buildkiteWorkflow(): string {
  return `steps:\n  - label: ":test_tube: Jentra Checks"\n    commands:\n      - npm ci\n      - npx jentra check local --candidate "$BUILDKITE_COMMIT" --runner external-ci --runner-id "buildkite:$BUILDKITE_BUILD_ID:$BUILDKITE_JOB_ID" --output .jentra/check-result.json --json\n    artifact_paths:\n      - .jentra/check-result.json\n`;
}

function azureWorkflow(): string {
  return `trigger:\n  - main\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - task: NodeTool@0\n    inputs:\n      versionSpec: 24.x\n  - script: npm ci\n  - script: npx jentra check local --candidate "$(Build.SourceVersion)" --runner external-ci --runner-id "azure:$(Build.BuildId):$(System.JobId)" --output .jentra/check-result.json --json\n  - publish: .jentra/check-result.json\n    artifact: jentra-check-receipt\n    condition: always()\n`;
}

function cloudflareBuildCommand(): string {
  return `#!/usr/bin/env sh\nset -eu\nnpm ci\nCANDIDATE="\${CF_PAGES_COMMIT_SHA:-\${COMMIT_SHA:-unknown}}"\nnpx jentra check local --candidate "$CANDIDATE" --runner external-ci --runner-id "cloudflare:\${CF_PAGES_BRANCH:-workers-build}:$CANDIDATE" --output .jentra/check-result.json --json\n`;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function authenticationHeaders(): Record<string, string> {
  if (process.env.JENTRA_TEST_PARTICIPANT)
    return { "x-jentra-test-participant": process.env.JENTRA_TEST_PARTICIPANT };
  if (process.env.JENTRA_SESSION_TOKEN)
    return { authorization: `Bearer ${process.env.JENTRA_SESSION_TOKEN}` };
  throw new CliError(
    "AUTHENTICATION_NOT_CONFIGURED",
    "Authentication is not configured. Set JENTRA_SESSION_TOKEN, or JENTRA_TEST_PARTICIPANT for local development.",
  );
}
