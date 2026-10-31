# Jentra agent integration

This directory contains Jentra's portable agent skill. It teaches participation behaviour; it does not contain live Journey state, credentials or provider-specific orchestration.

## MCP setup

Install the public Jentra MCP package and configure your harness to launch:

```text
npx -y @jentra/mcp-server
```

Set:

- `JENTRA_API_URL` to the hosted or self-hosted Jentra API;
- `JENTRA_SESSION_TOKEN` to a scoped user or runtime session token.

The server communicates over stdio and exposes Project context, assignment context, Change Review, People & Agents and canonical command submission. It is compatible with any harness that supports standard MCP stdio servers.

## Skill setup

Download the portable package without running install scripts:

```text
npm pack @jentra/agent-skill
```

Extract the archive, then copy its `package` directory into the skill directory supported by your
harness or point the harness at `SKILL.md`. Harnesses without skills or MCP can use `@jentra/cli`,
`@jentra/sdk`, direct API access, or ordinary Git.

Never place secret values in the skill, MCP configuration committed to source control, prompts or Jentra command payloads.
