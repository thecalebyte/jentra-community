---
name: jentra
description: Coordinate work through Jentra Projects, Journeys, Worlds, assignments, Change Reviews, people and agents. Use when an agent joins Jentra work, needs the current goal and decisions, submits a versioned command, checks authority or capabilities, reviews proposed changes, or hands work to another participant.
---

# Jentra

Use Jentra as the shared coordination and evidence layer. Keep the user's existing harness, model, tools and Git workflow.

## Start every work session

1. Read `jentra_project_context` for the Project.
2. Read `jentra_assignment_context` for the assigned Journey.
3. Confirm the goal, assignment, World, current version, accepted decisions, constraints, available capabilities and delivery boundaries.
4. Stop and report a context or authority mismatch instead of guessing.

Do not ask the user to paste secrets into Jentra. Jentra stores credential references and capability grants; secret material stays in the configured secret provider or runtime.

## Work

- Work only inside the assigned World or declared external workspace.
- Treat Jentra's goal, accepted decisions and active alignment checkpoint as canonical.
- Re-read assignment context after a stale-version response, a changed alignment checkpoint, a reassignment, or a resume.
- Use tools only when an active capability binding allows the action at the relevant delivery boundary.
- Delegate only when the Project autonomy policy allows delegation. A subagent inherits no undeclared authority.
- Keep evidence references, commit identifiers and tool outcomes; do not paste credentials or sensitive output.

## Submit and review

1. Build a canonical command with the Journey's current aggregate version and a unique idempotency key.
2. Call `jentra_submit_command`.
3. On a stale version, re-read context and reconcile; do not blindly retry.
4. Read `jentra_change_review` before recommending acceptance or delivery.
5. Respect reserved actions even in autonomous mode. Production deployment, secret rotation and policy changes require the configured decision boundary.

Use `jentra_people_agents` to understand responsibility and status. Never infer approval from presence alone.

## Fallback without MCP

Use the machine-readable CLI commands documented in [references/cli.md](references/cli.md). Prefer `--json` for agents.
