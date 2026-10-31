#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CommandEnvelopeSchema,
  ProjectCreateRequestSchema,
  ProjectJourneyStartRequestSchema,
  type CommandEnvelope,
} from "@jentra/contracts";

interface Participant {
  id: string;
  displayName: string;
  kind: "HUMAN" | "AGENT";
  joinedAt: string;
}
interface Event {
  id: string;
  sequence: number;
  type: string;
  at: string;
  actorId: string;
  payload: Record<string, unknown>;
}
interface Journey {
  id: string;
  projectId: string;
  layer: "QUICK_TASK" | "MANAGED_JOURNEY";
  outcome: string;
  workKind: string;
  autonomy: string;
  version: number;
  status: "ACTIVE" | "COMPLETED";
  createdAt: string;
  participants: Participant[];
  events: Event[];
  commands: Record<string, unknown>;
}
interface Project {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  participants: Participant[];
  repositoryPath?: string;
  repositoryHead?: string;
}
interface World {
  id: string;
  journeyId: string;
  projectId: string;
  name: string;
  ownerId: string;
  path: string;
  branch: string;
  baselineCommit: string;
  status: "READY" | "BLOCKED";
  createdAt: string;
}
interface Contribution {
  id: string;
  journeyId: string;
  worldId: string;
  authorId: string;
  summary: string;
  commit: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
  createdAt: string;
}
interface State {
  schemaVersion: 2;
  projects: Record<string, Project>;
  journeys: Record<string, Journey>;
  worlds: Record<string, World>;
  contributions: Record<string, Contribution>;
}

export interface CommunityRuntimeOptions {
  host?: string;
  port?: number;
  dataFile?: string;
  token?: string;
}

const execFileAsync = promisify(execFile);
const empty = (): State => ({
  schemaVersion: 2,
  projects: {},
  journeys: {},
  worlds: {},
  contributions: {},
});

class Store {
  private state: State = empty();
  constructor(readonly path: string) {}
  async load() {
    try {
      const parsed = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as Partial<State>;
      this.state = {
        schemaVersion: 2,
        projects: parsed.projects ?? {},
        journeys: parsed.journeys ?? {},
        worlds: parsed.worlds ?? {},
        contributions: parsed.contributions ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  read() {
    return this.state;
  }
  async change<T>(fn: (state: State) => T): Promise<T> {
    const result = fn(this.state);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.path);
    return result;
  }
}

export async function startCommunityRuntime(
  options: CommunityRuntimeOptions = {},
) {
  const host = options.host ?? process.env.JENTRA_COMMUNITY_HOST ?? "127.0.0.1";
  const port =
    options.port ?? Number(process.env.JENTRA_COMMUNITY_PORT ?? 4317);
  const token = options.token ?? process.env.JENTRA_COMMUNITY_TOKEN;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && !token)
    throw new Error("A JENTRA_COMMUNITY_TOKEN is required outside loopback.");
  const store = new Store(
    resolve(
      options.dataFile ??
        process.env.JENTRA_COMMUNITY_DATA ??
        ".jentra/community.json",
    ),
  );
  await store.load();
  const server = createServer(
    (request, response) => void route(request, response, store, token),
  );
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, host, done);
  });
  return {
    server,
    url: `http://${host}:${String(port)}`,
    dataFile: store.path,
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: Store,
  token?: string,
) {
  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/health") {
      json(response, 200, {
        status: "ok",
        edition: "community",
        schemaVersion: 2,
      });
      return;
    }
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      problem(
        response,
        401,
        "AUTH_REQUIRED",
        "Supply the configured Community Runtime token.",
      );
      return;
    }
    const participantId = String(
      request.headers["x-jentra-test-participant"] ?? "local-user",
    );
    if (url.pathname === "/" && request.method === "GET") {
      html(response, dashboard(store.read()));
      return;
    }
    if (url.pathname === "/community/projects" && request.method === "POST") {
      const form = await formBody(request);
      await createProject(store, {
        name: requiredFormValue(form, "name"),
        source: form.get("source") ?? "NEW_PROJECT",
        participantId,
      });
      redirect(response, "/#projects");
      return;
    }
    if (url.pathname === "/community/journeys" && request.method === "POST") {
      const form = await formBody(request);
      await createJourney(store, {
        projectId: requiredFormValue(form, "projectId"),
        outcome: requiredFormValue(form, "outcome"),
        workKind: form.get("workKind") ?? "GENERAL",
        autonomy: form.get("autonomy") ?? "BALANCED",
        layer:
          form.get("layer") === "QUICK_TASK" ? "QUICK_TASK" : "MANAGED_JOURNEY",
        participantId,
      });
      redirect(response, "/#journeys");
      return;
    }
    if (url.pathname === "/community/source" && request.method === "POST") {
      const form = await formBody(request);
      const projectId = requiredFormValue(form, "projectId");
      const repositoryPath = requiredFormValue(form, "repositoryPath");
      await connectRepository(store, projectId, repositoryPath);
      redirect(response, "/#source");
      return;
    }
    if (url.pathname === "/community/worlds" && request.method === "POST") {
      const form = await formBody(request);
      await createWorld(store, {
        journeyId: requiredFormValue(form, "journeyId"),
        name: requiredFormValue(form, "name"),
        ownerId: requiredFormValue(form, "ownerId"),
      });
      redirect(response, "/#worlds");
      return;
    }
    if (url.pathname === "/community/messages" && request.method === "POST") {
      const form = await formBody(request);
      await addMessage(store, {
        journeyId: requiredFormValue(form, "journeyId"),
        actorId: participantId,
        audience: form.get("audience")?.trim() ?? "Everyone",
        message: requiredFormValue(form, "message"),
      });
      redirect(response, "/#coordination");
      return;
    }
    if (
      url.pathname === "/community/contributions" &&
      request.method === "POST"
    ) {
      const form = await formBody(request);
      await createContribution(store, {
        worldId: requiredFormValue(form, "worldId"),
        authorId: participantId,
        summary: requiredFormValue(form, "summary"),
      });
      redirect(response, "/#review");
      return;
    }
    const contributionDecision =
      /^\/community\/contributions\/([^/]+)\/(accept|reject)$/u.exec(
        url.pathname,
      );
    if (contributionDecision && request.method === "POST") {
      await decideContribution(
        store,
        decodeURIComponent(contributionDecision[1]!),
        contributionDecision[2] === "accept" ? "ACCEPTED" : "REJECTED",
        participantId,
      );
      redirect(response, "/#review");
      return;
    }
    if (url.pathname === "/v1/projects" && request.method === "POST") {
      const input = ProjectCreateRequestSchema.parse(await body(request));
      const project = await createProject(store, { ...input, participantId });
      json(response, 201, project);
      return;
    }
    const projectMatch = /^\/v1\/projects\/([^/]+)$/u.exec(url.pathname);
    if (projectMatch && request.method === "GET") {
      entity(
        response,
        store.read().projects[decodeURIComponent(projectMatch[1]!)],
        "PROJECT_NOT_FOUND",
      );
      return;
    }
    const collaborationMatch = /^\/v1\/projects\/([^/]+)\/collaboration$/u.exec(
      url.pathname,
    );
    if (collaborationMatch && request.method === "GET") {
      const project =
        store.read().projects[decodeURIComponent(collaborationMatch[1]!)];
      if (!project) {
        problem(response, 404, "PROJECT_NOT_FOUND", "Project not found.");
        return;
      }
      const journeys = Object.values(store.read().journeys).filter(
        (item) => item.projectId === project.id,
      );
      json(response, 200, {
        project,
        journeys: journeys.map(summary),
        authority: {
          mode: "OWNER_CONTROLLED",
          deliveryRequiresExplicitCommand: true,
        },
        capabilities: [
          "local-coordination",
          "mcp",
          "cli",
          "sdk",
          "local-checks",
        ],
      });
      return;
    }
    const projectPeople = /^\/v1\/projects\/([^/]+)\/people-agents$/u.exec(
      url.pathname,
    );
    if (projectPeople && request.method === "GET") {
      entity(
        response,
        {
          participants:
            store.read().projects[decodeURIComponent(projectPeople[1]!)]
              ?.participants ?? [],
        },
        "PROJECT_NOT_FOUND",
      );
      return;
    }
    const journeyStart = /^\/v1\/projects\/([^/]+)\/journeys$/u.exec(
      url.pathname,
    );
    if (journeyStart && request.method === "POST") {
      const projectId = decodeURIComponent(journeyStart[1]!);
      if (!store.read().projects[projectId]) {
        problem(response, 404, "PROJECT_NOT_FOUND", "Project not found.");
        return;
      }
      const input = ProjectJourneyStartRequestSchema.parse(await body(request));
      const journey = await createJourney(store, {
        journeyId: input.journeyId,
        projectId,
        layer: input.layer,
        outcome: input.answers.outcome,
        workKind: input.answers.workKind,
        autonomy: input.answers.autonomy,
        participantId,
      });
      json(response, 201, journey);
      return;
    }
    const journeyMatch = /^\/v1\/journeys\/([^/]+)$/u.exec(url.pathname);
    if (journeyMatch && request.method === "GET") {
      const journey = findJourney(store, journeyMatch[1]!);
      if (journey)
        json(response, 200, { state: journey, events: journey.events });
      else problem(response, 404, "JOURNEY_NOT_FOUND", "Journey not found.");
      return;
    }
    const viewMatch =
      /^\/v1\/journeys\/([^/]+)\/(experience|change-review|people-agents)$/u.exec(
        url.pathname,
      );
    if (viewMatch && request.method === "GET") {
      const journey = findJourney(store, viewMatch[1]!);
      if (!journey) {
        problem(response, 404, "JOURNEY_NOT_FOUND", "Journey not found.");
        return;
      }
      json(
        response,
        200,
        viewMatch[2] === "experience"
          ? context(journey, store.read())
          : viewMatch[2] === "change-review"
            ? review(journey, store.read())
            : { participants: journey.participants },
      );
      return;
    }
    const commandMatch = /^\/v1\/journeys\/([^/]+)\/commands$/u.exec(
      url.pathname,
    );
    if (commandMatch && request.method === "POST") {
      const journey = findJourney(store, commandMatch[1]!);
      if (!journey) {
        problem(response, 404, "JOURNEY_NOT_FOUND", "Journey not found.");
        return;
      }
      const command = CommandEnvelopeSchema.parse(await body(request));
      if (command.journeyId !== journey.id) {
        problem(
          response,
          400,
          "JOURNEY_MISMATCH",
          "Command Journey does not match the route.",
        );
        return;
      }
      const existing = journey.commands[command.idempotencyKey];
      if (existing) {
        json(response, 200, existing);
        return;
      }
      if (
        command.aggregateVersionExpected !== "ANY_ALLOWED" &&
        command.aggregateVersionExpected !== journey.version
      ) {
        problem(
          response,
          409,
          "VERSION_CONFLICT",
          "Read current context and retry with its version.",
          journey.version,
        );
        return;
      }
      const receipt = await applyCommand(store, journey.id, command);
      json(response, 202, receipt);
      return;
    }
    problem(response, 404, "NOT_FOUND", "Route not found.");
    return;
  } catch (error) {
    problem(
      response,
      400,
      "INVALID_REQUEST",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
}

async function createProject(
  store: Store,
  input: {
    projectId?: string | undefined;
    name: string;
    source: string;
    participantId: string;
  },
) {
  const id = input.projectId ?? randomUUID();
  return store.change(
    (state) =>
      (state.projects[id] ??= {
        id,
        name: input.name,
        source: input.source,
        createdAt: now(),
        participants: [human(input.participantId)],
      }),
  );
}

async function createJourney(
  store: Store,
  input: {
    journeyId?: string | undefined;
    projectId: string;
    layer: "QUICK_TASK" | "MANAGED_JOURNEY";
    outcome: string;
    workKind: string;
    autonomy: string;
    participantId: string;
  },
) {
  if (!store.read().projects[input.projectId])
    throw new Error("Project not found.");
  const id = input.journeyId ?? randomUUID();
  return store.change(
    (state) =>
      (state.journeys[id] ??= {
        id,
        projectId: input.projectId,
        layer: input.layer,
        outcome: input.outcome,
        workKind: input.workKind,
        autonomy: input.autonomy,
        version: 1,
        status: "ACTIVE",
        createdAt: now(),
        participants: [human(input.participantId)],
        events: [
          {
            id: randomUUID(),
            sequence: 1,
            type: "JourneyStarted",
            at: now(),
            actorId: input.participantId,
            payload: { outcome: input.outcome },
          },
        ],
        commands: {},
      }),
  );
}

async function connectRepository(
  store: Store,
  projectId: string,
  requestedPath: string,
) {
  const project = store.read().projects[projectId];
  if (!project) throw new Error("Project not found.");
  const repositoryPath = resolve(requestedPath);
  const { stdout: rootOutput } = await execFileAsync(
    "git",
    ["-C", repositoryPath, "rev-parse", "--show-toplevel"],
    { windowsHide: true },
  );
  const root = resolve(rootOutput.trim());
  const comparableRoot =
    process.platform === "win32" ? root.toLowerCase() : root;
  const comparableRequested =
    process.platform === "win32"
      ? repositoryPath.toLowerCase()
      : repositoryPath;
  if (comparableRoot !== comparableRequested)
    throw new Error(`Use the repository root: ${root}`);
  const { stdout: headOutput } = await execFileAsync(
    "git",
    ["-C", root, "rev-parse", "HEAD"],
    {
      windowsHide: true,
    },
  );
  return store.change((state) => {
    const current = state.projects[projectId]!;
    current.repositoryPath = root;
    current.repositoryHead = headOutput.trim();
    return current;
  });
}

async function createWorld(
  store: Store,
  input: { journeyId: string; name: string; ownerId: string },
) {
  const journey = store.read().journeys[input.journeyId];
  if (!journey) throw new Error("Journey not found.");
  const project = store.read().projects[journey.projectId];
  if (!project?.repositoryPath || !project.repositoryHead)
    throw new Error("Connect a local Git repository before creating a World.");
  const id = randomUUID();
  const branch = `jentra/${id}`;
  const worldPath = resolve(dirname(store.path), "worlds", id);
  await mkdir(dirname(worldPath), { recursive: true });
  await execFileAsync(
    "git",
    [
      "-C",
      project.repositoryPath,
      "worktree",
      "add",
      "-b",
      branch,
      worldPath,
      project.repositoryHead,
    ],
    { windowsHide: true },
  );
  return store.change((state) => {
    const world: World = {
      id,
      journeyId: journey.id,
      projectId: project.id,
      name: input.name,
      ownerId: input.ownerId,
      path: worldPath,
      branch,
      baselineCommit: project.repositoryHead!,
      status: "READY",
      createdAt: now(),
    };
    state.worlds[id] = world;
    state.journeys[journey.id]!.events.push({
      id: randomUUID(),
      sequence: state.journeys[journey.id]!.events.length + 1,
      type: "WorldCreated",
      at: now(),
      actorId: input.ownerId,
      payload: {
        worldId: id,
        name: input.name,
        baselineCommit: project.repositoryHead,
      },
    });
    return world;
  });
}

async function addMessage(
  store: Store,
  input: {
    journeyId: string;
    actorId: string;
    audience: string;
    message: string;
  },
) {
  return store.change((state) => {
    const journey = state.journeys[input.journeyId];
    if (!journey) throw new Error("Journey not found.");
    journey.version += 1;
    journey.events.push({
      id: randomUUID(),
      sequence: journey.events.length + 1,
      type: "CoordinationMessage",
      at: now(),
      actorId: input.actorId,
      payload: { audience: input.audience, message: input.message },
    });
  });
}

async function createContribution(
  store: Store,
  input: { worldId: string; authorId: string; summary: string },
) {
  const world = store.read().worlds[input.worldId];
  if (!world) throw new Error("World not found.");
  const { stdout } = await execFileAsync(
    "git",
    ["-C", world.path, "rev-parse", "HEAD"],
    {
      windowsHide: true,
    },
  );
  const id = randomUUID();
  return store.change((state) => {
    const contribution: Contribution = {
      id,
      journeyId: world.journeyId,
      worldId: world.id,
      authorId: input.authorId,
      summary: input.summary,
      commit: stdout.trim(),
      status: "PROPOSED",
      createdAt: now(),
    };
    state.contributions[id] = contribution;
    state.journeys[world.journeyId]!.events.push({
      id: randomUUID(),
      sequence: state.journeys[world.journeyId]!.events.length + 1,
      type: "ContributionProposed",
      at: now(),
      actorId: input.authorId,
      payload: {
        contributionId: id,
        worldId: world.id,
        commit: contribution.commit,
      },
    });
    return contribution;
  });
}

async function decideContribution(
  store: Store,
  contributionId: string,
  status: "ACCEPTED" | "REJECTED",
  actorId: string,
) {
  return store.change((state) => {
    const contribution = state.contributions[contributionId];
    if (!contribution) throw new Error("Contribution not found.");
    contribution.status = status;
    const journey = state.journeys[contribution.journeyId]!;
    journey.version += 1;
    journey.events.push({
      id: randomUUID(),
      sequence: journey.events.length + 1,
      type:
        status === "ACCEPTED" ? "ContributionAccepted" : "ContributionRejected",
      at: now(),
      actorId,
      payload: { contributionId },
    });
    return contribution;
  });
}

async function applyCommand(
  store: Store,
  journeyId: string,
  command: CommandEnvelope,
) {
  return store.change((state) => {
    const journey = state.journeys[journeyId]!;
    journey.version += 1;
    const event: Event = {
      id: randomUUID(),
      sequence: journey.events.length + 1,
      type: command.commandType,
      at: now(),
      actorId: command.actor.participantId,
      payload: command.payload,
    };
    journey.events.push(event);
    if (
      !journey.participants.some(
        (item) => item.id === command.actor.participantId,
      )
    )
      journey.participants.push({
        id: command.actor.participantId,
        displayName: command.actor.participantId,
        kind: command.actor.runtimeId ? "AGENT" : "HUMAN",
        joinedAt: now(),
      });
    if (command.commandType === "CompleteJourney") journey.status = "COMPLETED";
    const receipt = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      status: "ACCEPTED",
      aggregateVersion: journey.version,
      lastSequence: event.sequence,
      result: { eventId: event.id },
    };
    journey.commands[command.idempotencyKey] = receipt;
    return receipt;
  });
}

const context = (journey: Journey, state: State) => ({
  edition: "community",
  journey: summary(journey),
  direction: {
    revision: journey.version,
    outcome: journey.outcome,
    current: true,
  },
  assignments: journey.events.filter((item) => /assign/i.test(item.type)),
  decisions: journey.events.filter((item) =>
    /decid|accept|reject/i.test(item.type),
  ),
  evidence: journey.events.filter((item) =>
    /evidence|check|result|contribution/i.test(item.type),
  ),
  recentActivity: journey.events.slice(-20),
  worlds: Object.values(state.worlds).filter(
    (item) => item.journeyId === journey.id,
  ),
  contributions: Object.values(state.contributions).filter(
    (item) => item.journeyId === journey.id,
  ),
  authority: {
    autonomy: journey.autonomy,
    consequentialActionsRequireExplicitCommand: true,
  },
});
const review = (journey: Journey, state: State) => ({
  journeyId: journey.id,
  status: journey.status,
  directionRevision: journey.version,
  proposedChanges: journey.events.filter((item) =>
    /contribution|result|change/i.test(item.type),
  ),
  assurance: journey.events.filter((item) =>
    /check|verify|assurance/i.test(item.type),
  ),
  decisions: journey.events.filter((item) =>
    /decid|accept|reject/i.test(item.type),
  ),
  contributions: Object.values(state.contributions).filter(
    (item) => item.journeyId === journey.id,
  ),
  deliveryReady: journey.status === "COMPLETED",
});
const summary = (journey: Journey) => ({
  id: journey.id,
  projectId: journey.projectId,
  outcome: journey.outcome,
  workKind: journey.workKind,
  autonomy: journey.autonomy,
  layer: journey.layer,
  status: journey.status,
  version: journey.version,
  createdAt: journey.createdAt,
});
const human = (id: string): Participant => ({
  id,
  displayName: id,
  kind: "HUMAN",
  joinedAt: now(),
});
const now = () => new Date().toISOString();
const findJourney = (store: Store, encoded: string) =>
  store.read().journeys[decodeURIComponent(encoded)];
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : new Uint8Array(chunk as Uint8Array);
    size += value.byteLength;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
}
async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  const value = await rawBody(request);
  return new URLSearchParams(value);
}
async function rawBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : new Uint8Array(chunk as Uint8Array);
    size += value.byteLength;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function requiredFormValue(form: URLSearchParams, name: string): string {
  const value = form.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
function html(response: ServerResponse, value: string) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  });
  response.end(value);
}
function redirect(response: ServerResponse, location: string) {
  response.writeHead(303, { location, "cache-control": "no-store" });
  response.end();
}
function entity(response: ServerResponse, value: unknown, code: string) {
  if (value) json(response, 200, value);
  else problem(response, 404, code, "Resource not found.");
}
function problem(
  response: ServerResponse,
  status: number,
  code: string,
  messagePlain: string,
  currentVersion?: number,
) {
  json(response, status, {
    code,
    messagePlain,
    ...(currentVersion === undefined ? {} : { currentVersion }),
    retryClass:
      status === 409
        ? "REREAD_REQUIRED"
        : status >= 500
          ? "LATER"
          : "USER_ACTION",
    remediationActions: [messagePlain],
    correlationId: randomUUID(),
  });
}
function dashboard(state: State) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/gu,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  return dashboardPage(state, escape);
}

function dashboardPage(
  state: State,
  escape: (value: string) => string,
): string {
  const projects = Object.values(state.projects);
  const journeys = Object.values(state.journeys);
  const worlds = Object.values(state.worlds);
  const contributions = Object.values(state.contributions);
  const projectOptions = projects
    .map(
      (item) =>
        `<option value="${escape(item.id)}">${escape(item.name)}</option>`,
    )
    .join("");
  const journeyOptions = journeys
    .map(
      (item) =>
        `<option value="${escape(item.id)}">${escape(item.outcome)}</option>`,
    )
    .join("");
  const worldOptions = worlds
    .map(
      (item) =>
        `<option value="${escape(item.id)}">${escape(item.name)}</option>`,
    )
    .join("");
  const messages = journeys
    .flatMap((journey) =>
      journey.events
        .filter((event) => event.type === "CoordinationMessage")
        .map((event) => ({ journey, event })),
    )
    .sort((left, right) => right.event.at.localeCompare(left.event.at));
  const payloadText = (value: unknown, fallback: string) =>
    typeof value === "string" ? value : fallback;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#131d36"><title>Jentra Community</title><style>${communityStyles}</style></head><body><header><a href="#top">Jentra Community</a><nav aria-label="Workspace"><a href="#direction">Direction</a><a href="#worlds">Worlds</a><a href="#coordination">Coordination</a><a href="#review">Review</a></nav></header><main id="top"><section class="intro"><div><h1>Keep the work moving without losing the thread.</h1><p>Set direction, open an isolated World, coordinate agents and decide what moves forward. Everything remains on this machine.</p></div><dl><div><dt>${String(projects.length)}</dt><dd>Projects</dd></div><div><dt>${String(worlds.length)}</dt><dd>Worlds</dd></div><div><dt>${String(contributions.filter((item) => item.status === "PROPOSED").length)}</dt><dd>Awaiting review</dd></div></dl></section><section id="direction"><div class="section-head"><div><h2>Direction</h2><p>Start with the intended outcome. Add process only when the work needs it.</p></div></div><div class="two"><form method="post" action="/community/projects"><h3>Create a Project</h3><label>Project name<input name="name" required maxlength="160" placeholder="Customer field guide"></label><label>Starting point<select name="source"><option value="NEW_PROJECT">New project</option><option value="EXISTING_REPOSITORY">Existing repository</option><option value="FILES">Files</option></select></label><button type="submit">Create Project</button></form><form method="post" action="/community/journeys"><h3>Start work</h3><label>Project<select name="projectId" required ${projects.length === 0 ? "disabled" : ""}>${projectOptions}</select></label><label>Outcome<input name="outcome" required maxlength="4000" placeholder="What should be true when this is done?" ${projects.length === 0 ? "disabled" : ""}></label><label>Route<select name="layer" ${projects.length === 0 ? "disabled" : ""}><option value="MANAGED_JOURNEY">Managed Journey</option><option value="QUICK_TASK">Quick Task</option></select></label><input type="hidden" name="workKind" value="GENERAL"><button type="submit" ${projects.length === 0 ? "disabled" : ""}>Start work</button>${projects.length === 0 ? '<p class="hint">Create a Project first.</p>' : ""}</form></div><div class="route">${journeys.map((journey) => `<article><span aria-hidden="true"></span><div><strong>${escape(journey.outcome)}</strong><small>${escape(journey.status)} · revision ${String(journey.version)}</small></div></article>`).join("") || '<p class="empty">No active route yet. Start work above.</p>'}</div></section><section id="source"><div class="section-head"><div><h2>Source</h2><p>Connect an existing local Git repository. Jentra records the baseline and leaves the original checkout intact.</p></div></div><form class="inline-form" method="post" action="/community/source"><label>Project<select name="projectId" required ${projects.length === 0 ? "disabled" : ""}>${projectOptions}</select></label><label>Repository root<input name="repositoryPath" required placeholder="C:\\work\\project" ${projects.length === 0 ? "disabled" : ""}></label><button type="submit" ${projects.length === 0 ? "disabled" : ""}>Connect repository</button></form><div class="rows">${projects.map((project) => `<article><div><strong>${escape(project.name)}</strong><small>${project.repositoryPath ? escape(project.repositoryPath) : "No repository connected"}</small></div><span>${project.repositoryHead ? escape(project.repositoryHead.slice(0, 10)) : "Not connected"}</span></article>`).join("")}</div></section><section id="worlds"><div class="section-head"><div><h2>Worlds</h2><p>Each World is a real Git worktree with its own branch and known baseline.</p></div></div><form class="inline-form" method="post" action="/community/worlds"><label>Journey<select name="journeyId" required ${journeys.length === 0 ? "disabled" : ""}>${journeyOptions}</select></label><label>World name<input name="name" required placeholder="Research route" ${journeys.length === 0 ? "disabled" : ""}></label><label>Owner or agent<input name="ownerId" required placeholder="agent-a" ${journeys.length === 0 ? "disabled" : ""}></label><button type="submit" ${journeys.length === 0 ? "disabled" : ""}>Create isolated World</button></form><div class="rows">${worlds.map((world) => `<article><div><strong>${escape(world.name)}</strong><small>${escape(world.ownerId)} · ${escape(world.branch)}</small></div><span>${escape(world.status)}</span></article>`).join("") || '<p class="empty">Connect a repository and create a World when parallel work needs isolation.</p>'}</div></section><section id="coordination"><div class="section-head"><div><h2>Coordination</h2><p>Speak to everyone or name a participant. Messages become shared Journey context.</p></div></div><div class="conversation"><div class="thread">${messages.map(({ journey, event }) => `<article><header><strong>${escape(event.actorId)}</strong><span>to ${escape(payloadText(event.payload.audience, "Everyone"))}</span><time>${escape(event.at)}</time></header><p>${escape(payloadText(event.payload.message, ""))}</p><small>${escape(journey.outcome)}</small></article>`).join("") || '<p class="empty">No messages yet. State what changed, what is blocked, or what another agent needs.</p>'}</div><form method="post" action="/community/messages"><label>Journey<select name="journeyId" required ${journeys.length === 0 ? "disabled" : ""}>${journeyOptions}</select></label><label>Audience<input name="audience" value="Everyone" ${journeys.length === 0 ? "disabled" : ""}></label><label>Message<textarea name="message" required rows="4" placeholder="Share a decision, blocker or request…" ${journeys.length === 0 ? "disabled" : ""}></textarea></label><button type="submit" ${journeys.length === 0 ? "disabled" : ""}>Send to Journey</button></form></div></section><section id="review"><div class="section-head"><div><h2>Change Review</h2><p>Attach a result to its World and decide explicitly what moves forward.</p></div><span class="boundary">No automatic merge or deployment</span></div><form class="inline-form" method="post" action="/community/contributions"><label>World<select name="worldId" required ${worlds.length === 0 ? "disabled" : ""}>${worldOptions}</select></label><label>Summary<input name="summary" required placeholder="What changed and why" ${worlds.length === 0 ? "disabled" : ""}></label><button type="submit" ${worlds.length === 0 ? "disabled" : ""}>Propose current commit</button></form><div class="review-list">${contributions.map((item) => `<article><div><span class="status ${item.status.toLowerCase()}">${escape(item.status)}</span><h3>${escape(item.summary)}</h3><p>Commit <code>${escape(item.commit.slice(0, 12))}</code> · ${escape(item.authorId)}</p></div>${item.status === "PROPOSED" ? `<div class="decisions"><form method="post" action="/community/contributions/${encodeURIComponent(item.id)}/accept"><button type="submit">Accept</button></form><form method="post" action="/community/contributions/${encodeURIComponent(item.id)}/reject"><button class="secondary" type="submit">Reject</button></form></div>` : ""}</article>`).join("") || '<p class="empty">No proposed changes yet.</p>'}</div></section><section class="connect"><h2>Connect an agent</h2><pre>JENTRA_API_URL=http://127.0.0.1:4317\nJENTRA_TEST_PARTICIPANT=my-agent\nnpx @jentra/mcp-server</pre><p>The agent can read the same direction, Worlds, messages and review state shown here.</p></section></main></body></html>`;
}

const communityStyles = `:root{--ink:#131d36;--deep:#293653;--blue:#304f88;--route:#5b76aa;--paper:#edf1f6;--field:#fbfcfe;--line:#d0d8e4;--coral:#d4634d;--green:#315f54;--magenta:#ad3f5e;--muted:#52617a;color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--field);color:var(--ink);font:15px/1.6 Manrope,system-ui,sans-serif}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:62px;padding:0 clamp(20px,4vw,52px);background:var(--ink);color:#fff;border-bottom:1px solid #405071}header>a{color:#fff;font:700 19px/1.2 Manrope,sans-serif;text-decoration:none}header nav{display:flex;gap:22px}header nav a{color:#dce5f3;text-decoration:none}main{max-width:1180px;margin:auto;padding:0 clamp(20px,5vw,68px) 80px}.intro{display:grid;grid-template-columns:1.4fr .6fr;gap:60px;align-items:end;padding:82px 0 68px;border-bottom:1px solid var(--line)}h1,h2,h3{font-family:"Bricolage Grotesque",Manrope,sans-serif;letter-spacing:-.025em;text-wrap:balance}h1{max-width:780px;margin:0 0 20px;font-size:clamp(44px,6vw,76px);line-height:.98}h2{margin:0;font-size:clamp(32px,4vw,48px);line-height:1.05}h3{margin:0 0 10px;font-size:20px}.intro p,.section-head p,.connect p{max-width:68ch;color:var(--muted);font-size:17px}.intro dl{display:grid;grid-template-columns:repeat(3,1fr);margin:0;border-block:1px solid var(--line)}.intro dl div{padding:18px 8px}.intro dt{font-size:28px;font-weight:750}.intro dd{margin:0;color:var(--muted);font-size:12px}section:not(.intro){padding:64px 0;border-bottom:1px solid var(--line);scroll-margin-top:62px}.section-head{display:flex;justify-content:space-between;gap:30px;align-items:start;margin-bottom:28px}.section-head p{margin:8px 0 0}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}form{min-width:0}form:not(.inline-form):not(.decisions form){padding:24px;background:#fff;border:1px solid var(--line);border-radius:12px}label{display:grid;gap:6px;margin:0 0 14px;color:var(--muted);font-size:12px;font-weight:700}input,select,textarea,button{width:100%;min-height:42px;border:1px solid #aebbd0;border-radius:7px;padding:9px 11px;background:#fff;color:var(--ink);font:inherit}textarea{resize:vertical}button{border-color:var(--ink);background:var(--ink);color:#fff;font-weight:750;cursor:pointer}button:hover{background:var(--deep)}button.secondary{background:#fff;color:var(--ink)}button:disabled,input:disabled,select:disabled,textarea:disabled{cursor:not-allowed;opacity:.48}.hint,.empty{color:var(--muted)}.route{display:grid;margin-top:28px;border-top:1px solid var(--line)}.route article{position:relative;display:grid;grid-template-columns:22px 1fr;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}.route article>span{width:12px;height:12px;margin-top:6px;border:3px solid var(--field);border-radius:50%;background:var(--coral);outline:1px solid var(--coral)}.route strong,.route small,.rows strong,.rows small{display:block}.route small,.rows small{color:var(--muted)}.inline-form{display:grid;grid-template-columns:1fr 2fr auto;gap:14px;align-items:end;margin-bottom:26px;padding:20px;background:var(--paper);border:1px solid var(--line);border-radius:10px}.inline-form label{margin:0}.inline-form button{width:auto;min-width:170px}.rows,.review-list{border-top:1px solid var(--line)}.rows article,.review-list>article{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:17px 0;border-bottom:1px solid var(--line)}.rows article>span{font-size:12px;font-weight:750}.conversation{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr);gap:24px}.thread{min-height:300px;border-top:1px solid var(--line)}.thread article{padding:18px 0;border-bottom:1px solid var(--line)}.thread header{position:static;min-height:0;padding:0;background:none;color:var(--ink);border:0;justify-content:start}.thread header span,.thread time,.thread small{color:var(--muted);font-size:12px}.thread time{margin-left:auto}.thread p{margin:8px 0}.boundary,.status{display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border:1px solid #b8c4d7;border-radius:999px;font-size:11px;font-weight:750}.boundary{white-space:nowrap;background:var(--paper)}.status.accepted{color:var(--green);border-color:#82a99f}.status.rejected{color:var(--magenta);border-color:#c697a7}.review-list>article h3{margin-top:10px}.review-list>article p{margin:0;color:var(--muted)}code,pre{font-family:"Azeret Mono",ui-monospace,monospace}code{overflow-wrap:anywhere}.decisions{display:flex;gap:8px}.decisions form{padding:0;border:0}.decisions button{width:auto;min-width:86px}.connect pre{overflow:auto;padding:20px;background:var(--ink);color:#fff;border-radius:10px}:focus-visible{outline:3px solid #ec8e7c;outline-offset:3px}::selection{background:#f3d9d3;color:var(--ink)}@media(max-width:760px){header nav{display:none}.intro,.two,.conversation{grid-template-columns:1fr}.intro{gap:30px;padding-top:52px}.inline-form{grid-template-columns:1fr}.inline-form button{width:100%}.section-head,.rows article,.review-list>article{align-items:start;flex-direction:column}.boundary{white-space:normal}.decisions{width:100%}.decisions form{flex:1}.decisions button{width:100%}}`;

async function main() {
  const command = process.argv[2] ?? "start";
  if (command === "init") {
    const path = resolve(
      process.env.JENTRA_COMMUNITY_DATA ?? ".jentra/community.json",
    );
    const store = new Store(path);
    await store.load();
    await store.change(() => undefined);
    console.log(`Initialized ${path}`);
    return;
  }
  if (command === "start") {
    const runtime = await startCommunityRuntime();
    console.log(
      `Jentra Community Runtime: ${runtime.url}\nData: ${runtime.dataFile}`,
    );
    return;
  }
  console.error("Usage: jentra-community [init|start]");
  process.exitCode = 2;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/u, "$1"))
)
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
