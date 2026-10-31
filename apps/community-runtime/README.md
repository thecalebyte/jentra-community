# Jentra Community Runtime

The Community Runtime is a small, local-first Jentra coordination service. It gives the public SDK,
CLI, MCP server and agent skill a usable backend without the private hosted control plane.

```sh
npx @jentra/community-runtime init
npx @jentra/community-runtime start
```

Open `http://127.0.0.1:4317`, or connect another public Jentra tool:

```sh
JENTRA_API_URL=http://127.0.0.1:4317 JENTRA_TEST_PARTICIPANT=local-user npx @jentra/mcp-server
```

Data is stored in `.jentra/community.json`. The service binds to loopback by default. Set
`JENTRA_COMMUNITY_TOKEN` before binding it to another interface.

The local interface can create Projects and start Quick Tasks or Managed Journeys. Connect a local
Git repository to create Worlds as real worktrees, keep agents aligned through Journey messages and
propose a World's current commit for explicit Change Review. Jentra records accept or reject
decisions but never merges or deploys without a separate authorized action.

SDK, CLI and MCP clients see the same persisted direction, Worlds, coordination messages and review
state as the browser interface. Existing repositories remain intact when connection or World
creation fails.

The public runtime supports Projects, Journeys, participants, current context, Git-backed Worlds,
coordination messages, append-only command receipts, events, contribution review and the public MCP
operations. It does not include managed execution, hosted identity, billing, organization
administration or Jentra's private large-scale control-plane implementation.
