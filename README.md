# Jentra Community

Jentra Community is the public, local-first coordination layer for people and agents working across
the same outcome. It runs on your machine, keeps its state in your workspace and works with the
models, agents and tools you already use.

## What you can do

- Create Projects, Quick Tasks and Managed Journeys.
- Connect an existing local Git repository without replacing its current checkout.
- Create isolated Worlds as real Git worktrees and branches.
- Share Journey direction and coordination messages across participants.
- Propose a World's current commit and record an explicit accept or reject review decision.
- Connect agents through the TypeScript SDK, CLI, MCP server or portable agent skill.
- Build additional harness adapters against the conformance kit.

Jentra Community records coordination and review state. It does not silently merge, deploy or spend
money. Managed cloud execution, hosted identity, billing and the private large-scale control plane
are not part of this repository.

## Start locally

Requires Node.js 24 or later and Git.

```sh
npm install
npm run build
npx @jentra/community-runtime start
```

Open `http://127.0.0.1:4317`. The runtime binds to loopback by default and stores data in
`.jentra/community.json`.

Connect an MCP-compatible agent in a second terminal:

```sh
JENTRA_API_URL=http://127.0.0.1:4317 JENTRA_TEST_PARTICIPANT=my-agent npx @jentra/mcp-server
```

## Repository map

- `apps/community-runtime`: local coordination service and Living Atlas interface
- `apps/cli`: command-line client
- `apps/mcp-server`: MCP bridge for compatible agents
- `packages/contracts`: public schemas and protocol contracts
- `packages/sdk-typescript`: TypeScript client
- `packages/local-runner`: local process and verification support
- `distribution/adapter-conformance-kit`: portable adapter contract tests
- `distribution/jentra-agent-skill`: reusable agent instructions

## Verify the repository

```sh
npm ci
npm run check
```

The real-Git integration test creates a temporary repository, opens a World through `git worktree`,
commits a result, proposes it and carries it through Change Review.

## Licence

The public components in this repository are licensed under Apache-2.0. Jentra's hosted service and
private control-plane source are separate products and are not covered by this repository.
