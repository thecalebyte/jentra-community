import { describe, expect, it } from "vitest";
import {
  CapabilityBindingSchema,
  SourceConnectionMutationSchema,
} from "./index.js";

describe("human-agent collaboration contracts", () => {
  it("rejects embedded Git credentials", () => {
    expect(() =>
      SourceConnectionMutationSchema.parse({
        expectedVersion: 1,
        id: "source-1",
        provider: "GENERIC_HTTPS",
        remoteUrl: "https://user:secret@example.com/team/project.git",
        defaultBranch: "main",
        syncMode: "IMPORT_ONCE",
        privateSource: false,
      }),
    ).toThrow(/credentials/u);
  });

  it("models authority as bounded actions rather than secret values", () => {
    const binding = CapabilityBindingSchema.parse({
      id: "binding-1",
      subjectKind: "ASSIGNMENT",
      subjectId: "task-1",
      boundaryId: "development",
      credentialReferenceId: "credential-1",
      actions: ["workspace.read", "workspace.write", "git.commit"],
      constraints: { branch: "agent/task-1" },
      active: true,
    });
    expect(binding.actions).toContain("git.commit");
    expect(binding).not.toHaveProperty("secret");
  });
});
