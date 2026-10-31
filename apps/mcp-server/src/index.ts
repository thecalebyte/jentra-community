#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CommandEnvelopeSchema } from "@jentra/contracts";
import { JentraApiError, JentraClient } from "@jentra/sdk";
import * as z from "zod/v4";

function createServer(): McpServer {
  const client = jentraClient();
  const server = new McpServer({ name: "jentra", version: "0.1.0" });

  server.registerTool(
    "jentra_project_context",
    {
      description:
        "Read a Jentra Project's collaboration context, authority boundaries, source, capabilities and autonomy policy.",
      inputSchema: z.object({ projectId: z.string().min(1) }),
    },
    async ({ projectId }) =>
      result(() => client.projectCollaboration(projectId)),
  );
  server.registerTool(
    "jentra_assignment_context",
    {
      description:
        "Read the current Journey context an agent needs before it acts, including the goal, assignments, decisions and evidence.",
      inputSchema: z.object({ journeyId: z.string().min(1) }),
    },
    async ({ journeyId }) =>
      result(() => client.experience(journeyId, "advanced")),
  );
  server.registerTool(
    "jentra_change_review",
    {
      description:
        "Read the structured Change Review for a Journey: proposed changes, assurance, decisions, conflicts and delivery readiness.",
      inputSchema: z.object({ journeyId: z.string().min(1) }),
    },
    async ({ journeyId }) => result(() => client.changeReview(journeyId)),
  );
  server.registerTool(
    "jentra_people_agents",
    {
      description:
        "List the people and agents participating in a Project or one of its Journeys.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        journeyId: z.string().min(1).optional(),
      }),
    },
    async ({ projectId, journeyId }) =>
      result(() =>
        journeyId
          ? client.journeyPeopleAndAgents(journeyId)
          : client.projectPeopleAndAgents(projectId),
      ),
  );
  server.registerTool(
    "jentra_submit_command",
    {
      description:
        "Submit a canonical, versioned Jentra command. Use only after reading current context and never place secret values in the envelope.",
      inputSchema: CommandEnvelopeSchema,
    },
    async (command) => result(() => client.command(command)),
  );
  return server;
}

function jentraClient(): JentraClient {
  const baseUrl = process.env.JENTRA_API_URL ?? "https://jentra.dev";
  return new JentraClient(baseUrl, {
    authenticationHeaders: async () => {
      const token = process.env.JENTRA_SESSION_TOKEN;
      if (token) return { authorization: `Bearer ${token}` };
      const localParticipant = process.env.JENTRA_TEST_PARTICIPANT;
      if (localParticipant)
        return { "x-jentra-test-participant": localParticipant };
      throw new Error(
        "Set JENTRA_SESSION_TOKEN, or JENTRA_TEST_PARTICIPANT for local development.",
      );
    },
  });
}

async function result(work: () => Promise<unknown>) {
  try {
    const value = await work();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(value, null, 2) },
      ],
      structuredContent:
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : { value },
    };
  } catch (error) {
    const detail =
      error instanceof JentraApiError
        ? {
            code: error.code,
            message: error.message,
            retryClass: error.retryClass,
            remediationActions: error.remediationActions,
            correlationId: error.correlationId,
          }
        : { code: "JENTRA_MCP_ERROR", message: String(error) };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: detail }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

void serveStdio(createServer);
console.error("Jentra MCP server running on stdio.");
