import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { startCommunityRuntime } from "./index.js";

const servers: { close: (callback: () => void) => void }[] = [];
const execFile = promisify(execFileCallback);
afterEach(async () =>
  Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(done);
        }),
    ),
  ),
);

describe("Community Runtime", () => {
  it("creates a Project and Journey and serves agent context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jentra-community-"));
    const runtime = await startCommunityRuntime({
      host: "127.0.0.1",
      port: 0,
      dataFile: join(directory, "state.json"),
    });
    servers.push(runtime.server);
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${String(address.port)}`;
    const project = (await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jentra-test-participant": "owner",
      },
      body: JSON.stringify({ name: "Public runtime", source: "NEW_PROJECT" }),
    }).then((r) => r.json())) as { id: string };
    const journey = (await fetch(`${base}/v1/projects/${project.id}/journeys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jentra-test-participant": "owner",
      },
      body: JSON.stringify({
        layer: "MANAGED_JOURNEY",
        answers: {
          outcome: "Ship a useful public runtime",
          workKind: "SOFTWARE",
          source: "NEW_PROJECT",
          autonomy: "BALANCED",
          constraints: {
            sensitiveData: false,
            deploymentRequiresHuman: true,
            requiredHumanDecisions: true,
            budgetLimit: 1,
            timeLimitMinutes: 60,
          },
        },
      }),
    }).then((r) => r.json())) as { id: string };
    const context = (await fetch(
      `${base}/v1/journeys/${journey.id}/experience`,
    ).then((r) => r.json())) as { direction: { outcome: string } };
    expect(context.direction.outcome).toBe("Ship a useful public runtime");
  });

  it("lets a local user create work from the dashboard", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jentra-community-ui-"));
    const runtime = await startCommunityRuntime({
      host: "127.0.0.1",
      port: 0,
      dataFile: join(directory, "state.json"),
    });
    servers.push(runtime.server);
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${String(address.port)}`;
    const created = await fetch(`${base}/community/projects`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Dashboard project",
        source: "NEW_PROJECT",
      }),
    });
    expect(created.status).toBe(303);
    const dashboard = await fetch(base).then(async (response) =>
      response.text(),
    );
    expect(dashboard).toContain("Dashboard project");
    expect(dashboard).toContain("Start work");
  });

  it("creates a real Git-backed World and carries its contribution through review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jentra-community-git-"));
    const repository = join(directory, "repository");
    await execFile("git", ["init", repository]);
    await execFile("git", [
      "-C",
      repository,
      "config",
      "user.email",
      "community@jentra.dev",
    ]);
    await execFile("git", [
      "-C",
      repository,
      "config",
      "user.name",
      "Jentra Community",
    ]);
    await writeFile(join(repository, "README.md"), "# Field notes\n", "utf8");
    await execFile("git", ["-C", repository, "add", "README.md"]);
    await execFile("git", [
      "-C",
      repository,
      "commit",
      "-m",
      "Start field notes",
    ]);

    const runtime = await startCommunityRuntime({
      host: "127.0.0.1",
      port: 0,
      dataFile: join(directory, "state.json"),
    });
    servers.push(runtime.server);
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = `http://127.0.0.1:${String(address.port)}`;
    const project = (await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jentra-test-participant": "owner",
      },
      body: JSON.stringify({
        name: "Git field guide",
        source: "EXISTING_REPOSITORY",
      }),
    }).then((response) => response.json())) as { id: string };
    const journey = (await fetch(`${base}/v1/projects/${project.id}/journeys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jentra-test-participant": "owner",
      },
      body: JSON.stringify({
        layer: "MANAGED_JOURNEY",
        answers: {
          outcome: "Publish a verified field guide",
          workKind: "SOFTWARE",
          source: "EXISTING_REPOSITORY",
          autonomy: "BALANCED",
          constraints: {
            sensitiveData: false,
            deploymentRequiresHuman: true,
            requiredHumanDecisions: true,
            budgetLimit: 1,
            timeLimitMinutes: 60,
          },
        },
      }),
    }).then((response) => response.json())) as { id: string };

    const source = await fetch(`${base}/community/source`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        projectId: project.id,
        repositoryPath: repository,
      }),
    });
    const sourceBody = await source.text();
    expect(source.status, sourceBody).toBe(303);
    const worldResponse = await fetch(`${base}/community/worlds`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        projectId: project.id,
        journeyId: journey.id,
        name: "Draft route",
        ownerId: "agent-a",
      }),
    });
    const worldBody = await worldResponse.text();
    expect(worldResponse.status, worldBody).toBe(303);
    const firstContext = (await fetch(
      `${base}/v1/journeys/${journey.id}/experience`,
    ).then((response) => response.json())) as {
      worlds: { id: string; path: string }[];
    };
    expect(firstContext.worlds).toHaveLength(1);
    const world = firstContext.worlds[0]!;
    await writeFile(
      join(world.path, "guide.md"),
      "A verified route.\n",
      "utf8",
    );
    await execFile("git", ["-C", world.path, "add", "guide.md"]);
    await execFile("git", [
      "-C",
      world.path,
      "commit",
      "-m",
      "Add verified route",
    ]);
    const contribution = await fetch(`${base}/community/contributions`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        journeyId: journey.id,
        worldId: world.id,
        title: "Add the verified route",
        summary: "Ready for human review",
      }),
    });
    expect(contribution.status).toBe(303);
    const review = (await fetch(
      `${base}/v1/journeys/${journey.id}/change-review`,
    ).then((response) => response.json())) as {
      contributions: { id: string; status: string }[];
    };
    expect(review.contributions[0]?.status).toBe("PROPOSED");
    const accepted = await fetch(
      `${base}/community/contributions/${review.contributions[0]!.id}/accept`,
      { method: "POST", redirect: "manual" },
    );
    expect(accepted.status).toBe(303);
    const acceptedReview = (await fetch(
      `${base}/v1/journeys/${journey.id}/change-review`,
    ).then((response) => response.json())) as {
      contributions: { status: string }[];
    };
    expect(acceptedReview.contributions[0]?.status).toBe("ACCEPTED");
  });
});
