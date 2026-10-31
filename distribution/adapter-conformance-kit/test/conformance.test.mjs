import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHarness, requirementsFor } from "../src/index.mjs";

test("a generic adapter passes with the complete provider-neutral capability set", () => {
  const capabilities = requirementsFor("GENERIC_CLI_SDK");
  assert.deepEqual(
    evaluateHarness({ level: "GENERIC_CLI_SDK", capabilities }),
    { conformant: true, errors: [], missing: [] },
  );
});

test("human approval impersonation fails regardless of declared capabilities", () => {
  const result = evaluateHarness({
    level: "NATIVE_ADAPTER",
    capabilities: requirementsFor("NATIVE_ADAPTER"),
    canApproveHumanDecisions: true,
  });
  assert.equal(result.conformant, false);
  assert.deepEqual(result.errors, ["HUMAN_APPROVAL_IMPERSONATION"]);
});

test("missing lease recovery is reported", () => {
  const capabilities = requirementsFor("GENERIC_CLI_SDK").filter(
    (item) => item !== "LEASE_RECOVERY",
  );
  assert.deepEqual(
    evaluateHarness({ level: "GENERIC_CLI_SDK", capabilities }).missing,
    ["LEASE_RECOVERY"],
  );
});
