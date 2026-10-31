import { describe, expect, it } from "vitest";
import { JentraApiError, JentraClient } from "./index.js";

describe("JentraClient errors", () => {
  it("preserves structured remediation fields", async () => {
    const client = new JentraClient("https://jentra.test", async () =>
      Response.json(
        {
          code: "VERSION_CONFLICT",
          messagePlain: "Read the Journey again.",
          currentVersion: 7,
          retryClass: "REREAD_REQUIRED",
          remediationActions: ["Reread Journey state."],
          correlationId: "corr-1",
        },
        { status: 409 },
      ),
    );
    const error = await client
      .journey("journey-1")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(JentraApiError);
    expect(error).toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      currentVersion: 7,
      retryClass: "REREAD_REQUIRED",
      remediationActions: ["Reread Journey state."],
      correlationId: "corr-1",
    });
  });

  it("normalizes an invalid error response without losing the status", async () => {
    const client = new JentraClient("https://jentra.test", async () =>
      Response.json({ error: "proxy failure" }, { status: 502 }),
    );
    await expect(client.project("project-1")).rejects.toMatchObject({
      code: "UNEXPECTED_API_ERROR",
      status: 502,
      retryClass: "NEVER",
    });
  });
});

describe("JentraClient memory", () => {
  it("uses the authenticated memory lifecycle routes", async () => {
    const calls: { url: string; method: string }[] = [];
    const client = new JentraClient(
      "https://jentra.test",
      async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        calls.push({ url, method: init?.method ?? "GET" });
        return Response.json({ ok: true });
      },
    );
    const request = {
      memoryId: "memory-1",
      sourceEnvelopeId: "source-1",
      origin: "USER_STATEMENT" as const,
      sourceRef: "user:explicit",
      sourceHash: "a".repeat(64),
      independentSourceId: "user-1",
      memoryClass: "PERSONAL" as const,
      summary: "Prefer concise status updates.",
      content: "Prefer concise status updates.",
      validFrom: "2026-10-11T12:00:00.000Z",
    };

    await client.writeMemory(request);
    await client.memories({ includeDeleted: true, limit: 20 });
    await client.memory("memory/1");
    await client.correctMemory("memory/1", {
      ...request,
      memoryId: "memory-2",
    });
    await client.forgetMemory("memory/1");
    await client.purgeMemory("memory/1");
    await client.exportMemories();
    await client.memorySelection();
    await client.setMemorySelection({
      selectedMemoryIds: ["memory-1"],
      characterBudget: 4_000,
      advisoryRecallEnabled: true,
    });
    await client.searchMemories("concise status");
    await client.enforceMemoryRetention();
    await client.memoryUsage();
    await client.createMemoryExtractionCandidate({
      consent: true,
      sourceEnvelopeId: "source-candidate",
      sourceRef: "harness:proposal",
      independentSourceId: "agent-1",
      summary: "Candidate",
      content: "Candidate context",
    });
    await client.journeyMemories("journey/1");
    await client.memoryPromotions("journey/1");
    await client.requestMemoryPromotion("journey/1", {
      promotionId: "promotion-1",
      memoryId: "memory-1",
      rationale: "Useful for the Journey",
    });
    await client.reviewMemoryPromotion("journey/1", "promotion/1", "APPROVED");
    await client.retractJourneyMemory(
      "journey/1",
      "promotion/1",
      "No longer current",
    );

    expect(calls).toEqual([
      { url: "https://jentra.test/v1/memories", method: "POST" },
      {
        url: "https://jentra.test/v1/memories?limit=20&includeDeleted=true",
        method: "GET",
      },
      { url: "https://jentra.test/v1/memories/memory%2F1", method: "GET" },
      {
        url: "https://jentra.test/v1/memories/memory%2F1/correct",
        method: "POST",
      },
      {
        url: "https://jentra.test/v1/memories/memory%2F1/forget",
        method: "POST",
      },
      {
        url: "https://jentra.test/v1/memories/memory%2F1/purge",
        method: "DELETE",
      },
      { url: "https://jentra.test/v1/memories/export", method: "GET" },
      { url: "https://jentra.test/v1/memories/selection", method: "GET" },
      { url: "https://jentra.test/v1/memories/selection", method: "PUT" },
      {
        url: "https://jentra.test/v1/memories/search?q=concise%20status",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/memories/retention/enforce",
        method: "POST",
      },
      { url: "https://jentra.test/v1/memories/usage", method: "GET" },
      {
        url: "https://jentra.test/v1/memories/extraction-candidates",
        method: "POST",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/memories",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/memory-promotions",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/memory-promotions",
        method: "POST",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/memory-promotions/promotion%2F1/review",
        method: "POST",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/memories/promotion%2F1",
        method: "DELETE",
      },
    ]);
  });
});

describe("JentraClient collaboration", () => {
  it("exports a validated Journey Capsule from the authenticated Journey route", async () => {
    const calls: string[] = [];
    const capsule = {
      capsuleVersion: "1.0",
      journeyId: "journey/1",
      journeyVersion: 3,
      canonicalThroughSequence: 8,
      exportedAt: "2026-10-30T12:00:00.000Z",
      direction: {
        revisionId: "direction-1",
        version: 1,
        contentHash: "a".repeat(64),
        outcome: "Continue in an independent harness.",
        successCriteria: [
          "The receiving harness can resume without a private briefing.",
        ],
        constraints: [],
        nonGoals: [],
      },
      assignments: [],
      acceptedContributionRefs: [],
      evidenceRefs: [],
      decisionRefs: [],
      runtimeRequirements: [],
      contentHash: "b".repeat(64),
    };
    const client = new JentraClient("https://jentra.test", async (input) => {
      calls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Response.json(capsule);
    });

    await expect(client.journeyCapsule("journey/1")).resolves.toEqual(capsule);
    expect(calls).toEqual([
      "https://jentra.test/v1/journeys/journey%2F1/capsule",
    ]);
  });

  it("queries runtime eligibility with encoded adapter and capability filters", async () => {
    const calls: string[] = [];
    const client = new JentraClient("https://jentra.test", async (input) => {
      calls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Response.json([]);
    });

    await client.runtimeDiagnostics({
      adapter: "google-research/harness2",
      requiredCapabilities: ["workspace.read", "browser.use"],
    });

    expect(calls).toEqual([
      "https://jentra.test/v1/runtime-diagnostics?adapter=google-research%2Fharness2&capabilities=workspace.read%2Cbrowser.use",
    ]);
  });

  it("posts structured native-tool requirements without flattening versions or actions", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const client = new JentraClient(
      "https://jentra.test",
      async (input, init) => {
        calls.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        return Response.json([]);
      },
    );
    await client.runtimeDiagnostics({
      adapter: "codex",
      nativeTools: {
        vocabulary: "JENTRA_NATIVE_TOOLS",
        acceptedVocabularyVersions: [1],
        tools: [
          { id: "git", minimumVersion: "1.1", actions: ["read", "commit"] },
        ],
      },
    });
    expect(calls).toEqual([
      {
        url: "https://jentra.test/v1/runtime-diagnostics",
        method: "POST",
        body: {
          adapter: "codex",
          requiredCapabilities: [],
          nativeTools: {
            vocabulary: "JENTRA_NATIVE_TOOLS",
            acceptedVocabularyVersions: [1],
            tools: [
              { id: "git", minimumVersion: "1.1", actions: ["read", "commit"] },
            ],
          },
        },
      },
    ]);
  });

  it("uses provider-neutral project, review, people and policy routes", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const client = new JentraClient(
      "https://jentra.test",
      async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        calls.push({
          url,
          method: init?.method ?? "GET",
          ...(typeof init?.body === "string"
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        });
        return Response.json({ ok: true });
      },
    );

    await client.projectCollaboration("project/1");
    await client.projectPeopleAndAgents("project/1");
    await client.journeyPeopleAndAgents("journey/1");
    await client.changeReview("journey/1");
    await client.putProjectAutonomyPolicy("project/1", {
      expectedVersion: 2,
      mode: "AUTONOMOUS_WITHIN_POLICY",
      requireIndependentVerification: true,
      reservedActions: ["production.deploy"],
      allowAgentDelegation: true,
      maxParallelRuns: 12,
      revision: 1,
    });

    expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
      {
        url: "https://jentra.test/v1/projects/project%2F1/collaboration",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/projects/project%2F1/people-agents",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/people-agents",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/journeys/journey%2F1/change-review",
        method: "GET",
      },
      {
        url: "https://jentra.test/v1/projects/project%2F1/autonomy-policy",
        method: "PUT",
      },
    ]);
  });
});
