# Jentra adapter conformance kit

This Apache-2.0 package is the public, provider-neutral boundary for agent harnesses that integrate with Jentra. It contains no Jentra control-plane source and has no private package dependency.

The initial checks validate declared capability levels and reject authority bypass. They complement, but do not replace, live black-box testing against a Jentra installation.

```js
import { evaluateHarness, requirementsFor } from "@jentra/adapter-conformance";

const result = evaluateHarness({
  level: "GENERIC_CLI_SDK",
  capabilities: requirementsFor("GENERIC_CLI_SDK"),
});
```

No adapter may impersonate human approval, broaden credentials or authorise deployment. Passing these declaration checks is not certification of a named commercial product. Live certification must also exercise registration, claim, callback, stale-context, retry, revocation and recovery scenarios against supported Jentra protocol versions.

Run `npm test` before publishing. Publish this directory as its own package or repository; do not copy private monorepo history or internal design documents into the public repository.
