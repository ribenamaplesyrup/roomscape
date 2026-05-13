import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ViteDevServer } from "vite";
import type { AgentEvent } from "../../shared/api";
import { freshRoomConfig, type RoomConfig } from "../../shared/room";
import { AuthService } from "../auth/service";
import { AgentRunBus, type ArchitectRunner } from "../agent/architectRunner";
import { RoomCodeRepository, freshSceneSource, transpileSceneSource } from "../agent/roomCodeRepository";
import { CodexAppServerUnavailableError, type CodexAuthBridge } from "../codex/appServerClient";
import { ActiveRoomRepository } from "../storage/activeRoomRepository";
import { RoomRepository } from "../storage/roomRepository";
import type { DataStore } from "../storage/types";
import { readCookie, setRememberedDeviceCookie, setSessionCookie, clearSessionCookie, clearRememberedDeviceCookie } from "./cookies";
import { readJson, sendJson } from "./json";

interface AppDeps {
  store: DataStore;
  runner?: ArchitectRunner;
  runnerFactory?: (roomCode: RoomCodeRepository) => ArchitectRunner;
  bus: AgentRunBus;
  roomCode?: RoomCodeRepository;
  workspaceRoot?: string;
  codex?: CodexAuthBridge;
  vite?: ViteDevServer;
  staticRoot?: string;
}

interface UserRunState {
  generation: number;
  queue: Promise<void>;
  controllers: Set<AbortController>;
  runIds: Set<string>;
}

export function createApp({ store, runner, runnerFactory, bus, roomCode, workspaceRoot, codex, vite, staticRoot }: AppDeps) {
  const auth = new AuthService(store);
  const rooms = new RoomRepository(store);
  const activeRooms = new ActiveRoomRepository(store);
  const runStates = new Map<string, UserRunState>();
  const runOwners = new Map<string, string>();

  /** Handles API routes first, then delegates static and HMR traffic to Vite in development. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (vite) {
        vite.middlewares(req, res, () => {
          res.statusCode = 404;
          res.end("Not found");
        });
        return;
      }
      if (staticRoot) {
        await serveStatic(res, url, staticRoot);
        return;
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown server error." });
    }
  };

  async function requireUser(req: IncomingMessage) {
    const user = await auth.userForSession(readCookie(req, "roomscape_session"));
    if (!user) throw new HttpError(401, "Authentication required.");
    return user;
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const sessionId = readCookie(req, "roomscape_session");
      const rememberToken = readCookie(req, "roomscape_device");
      const user = await auth.userForSession(sessionId);
      if (user) cancelUserRuns(user.id, "Signed out; cleared active room edits.");
      await auth.logout(sessionId, rememberToken);
      clearSessionCookie(res, { secure: isSecureRequest(req) });
      clearRememberedDeviceCookie(res, { secure: isSecureRequest(req) });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      sendJson(res, 200, { user: await auth.userForSession(readCookie(req, "roomscape_session")) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/chatgpt/start") {
      const bridge = requireCodexBridge(codex);
      const login = await mapCodexErrors(() => bridge.startChatGptLogin());
      sendJson(res, 200, login);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/chatgpt/complete") {
      const bridge = requireCodexBridge(codex);
      const body = await readJson<{ loginId: string }>(req);
      if (!body.loginId?.trim()) throw new HttpError(400, "ChatGPT login id is required.");
      const account = await mapCodexErrors(() => bridge.completeChatGptLogin(body.loginId));
      if (!account) {
        sendJson(res, 202, { status: "pending" });
        return;
      }
      const result = await auth.authenticateWithChatGpt(account);
      await resetActiveRoomForUser(result.user.id, "Signed in; starting a fresh room.");
      setSessionCookie(res, result.sessionId, { secure: isSecureRequest(req) });
      setRememberedDeviceCookie(res, result.rememberToken, { secure: isSecureRequest(req) });
      sendJson(res, 200, { status: "authenticated", user: result.user });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/chatgpt/existing") {
      const remembered = await auth.authenticateWithRememberedDevice(readCookie(req, "roomscape_device"));
      if (remembered) {
        await resetActiveRoomForUser(remembered.user.id, "Signed in; starting a fresh room.");
        setSessionCookie(res, remembered.sessionId, { secure: isSecureRequest(req) });
        sendJson(res, 200, { status: "authenticated", user: remembered.user });
        return;
      }
      const bridge = requireCodexBridge(codex);
      const account = await mapCodexErrors(() => bridge.readChatGptAccount());
      if (!account) {
        sendJson(res, 202, { status: "pending" });
        return;
      }
      const result = await auth.authenticateWithChatGpt(account);
      await resetActiveRoomForUser(result.user.id, "Signed in; starting a fresh room.");
      setSessionCookie(res, result.sessionId, { secure: isSecureRequest(req) });
      setRememberedDeviceCookie(res, result.rememberToken, { secure: isSecureRequest(req) });
      sendJson(res, 200, { status: "authenticated", user: result.user });
      return;
    }

    const user = await requireUser(req);
    if (req.method === "GET" && url.pathname === "/api/usage") {
      if (user.authMode !== "chatgpt" || !codex) {
        sendJson(res, 200, { usage: null });
        return;
      }
      const record = await userRecord(user.id);
      sendJson(res, 200, { usage: await mapCodexErrors(() => codex.readRateLimits(record?.codexAuthRef)) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/rooms") {
      sendJson(res, 200, { rooms: await rooms.listForUser(user.id) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson<{ name: string; config?: RoomConfig }>(req);
      const sceneSource = await activeRooms.getSceneSource(user.id);
      const activeConfig = await activeRooms.getConfig(user.id);
      sendJson(res, 201, { room: await rooms.save(user.id, body.name, body.config ?? activeConfig, sceneSource) });
      return;
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === "GET" && roomMatch?.[1]) {
      const room = await rooms.get(user.id, roomMatch[1]);
      if (!room) throw new HttpError(404, "Room not found.");
      const activeConfig = await activeRooms.saveConfig(user.id, { ...room.config, name: room.name });
      const code = await roomCodeForUser(user.id);
      await code.writeConfig(activeConfig);
      const normalizedSceneSource = code.normalizeSceneSource(room.sceneSource);
      await code.writeSceneSource(normalizedSceneSource);
      const validationErrors = code.validateSceneSource(normalizedSceneSource);
      if (validationErrors.length > 0) {
        throw new HttpError(422, `Saved scene is invalid:\n${validationErrors.join("\n")}`);
      }
      await code.writeActiveSceneSource(normalizedSceneSource);
      await activeRooms.saveSceneSource(user.id, normalizedSceneSource);
      sendJson(res, 200, { room: { ...room, config: activeConfig } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/active-room") {
      sendJson(res, 200, { config: await activeRooms.getConfig(user.id) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/active-room/scene-module") {
      sendJson(res, 200, { source: transpileSceneSource(await activeRooms.getSceneSource(user.id)) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/active-room/reset") {
      const activeConfig = await resetActiveRoomForUser(user.id, "Room reset; cleared active room edits.");
      sendJson(res, 200, { config: activeConfig });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent/runs") {
      const body = await readJson<{ prompt: string; model: string; currentConfig?: RoomConfig }>(req);
      const runState = userRunState(user.id);
      const runId = randomUUID();
      const runVersion = runState.generation;
      const controller = new AbortController();
      const activeConfig = await activeRooms.getConfig(user.id);
      const currentConfig = body.currentConfig ?? activeConfig;
      const code = await roomCodeForUser(user.id);
      await materializeActiveRoom(user.id, code, currentConfig);
      const runRunner = runnerFactory ? runnerFactory(code) : requireRunner(runner);
      runState.controllers.add(controller);
      runState.runIds.add(runId);
      runOwners.set(runId, user.id);
      const record = await userRecord(user.id);
      const codexHome = record?.codexAuthRef && codex?.codexHomeForAuthRef ? codex.codexHomeForAuthRef(record.codexAuthRef) : undefined;
      bus.publish(runId, { type: "log", message: "Queued room edit.", at: new Date().toISOString() });
      runState.queue = runState.queue
        .catch(() => undefined)
        .then(async () => {
          if (runVersion !== runState.generation || controller.signal.aborted) return;
          let runnerEventQueue = Promise.resolve();
          const enqueueRunnerEvent = (event: AgentEvent): void => {
            runnerEventQueue = runnerEventQueue
              .then(async () => {
                if (runVersion !== runState.generation || controller.signal.aborted) return;
                if (event.type === "room-updated") await activeRooms.saveConfig(user.id, event.config);
                if (event.type === "scene-updated") await persistActiveScene(user.id, code);
                if (event.type === "error" && isStaleCodexRefreshTokenError(event.message)) {
                  await auth.invalidateCodexAuth(user.id);
                }
                bus.publish(runId, event);
              })
              .catch((error: unknown) => {
                bus.publish(runId, { type: "error", message: error instanceof Error ? error.message : "Unable to process generated room update.", at: new Date().toISOString() });
              });
          };
          bus.publish(runId, { type: "log", message: "Starting queued room edit.", at: new Date().toISOString() });
          await runRunner.run(
            {
              runId,
              prompt: body.prompt,
              model: body.model,
              currentConfig,
              ...(codexHome ? { codexHome } : {}),
              signal: controller.signal,
            },
            enqueueRunnerEvent,
          );
          await runnerEventQueue;
          await persistActiveScene(user.id, code);
        })
        .finally(() => {
          runState.controllers.delete(controller);
          runState.runIds.delete(runId);
          runOwners.delete(runId);
        });
      sendJson(res, 202, { runId });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent/runs/cancel") {
      cancelUserRuns(user.id, "Room edit cancelled.");
      sendJson(res, 200, { ok: true });
      return;
    }
    const eventMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch?.[1]) {
      if (runOwners.get(eventMatch[1]) !== user.id) throw new HttpError(404, "Run not found.");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const unsubscribe = bus.subscribe(eventMatch[1], (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      req.on("close", unsubscribe);
      return;
    }

    throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
  }

  function userRunState(userId: string): UserRunState {
    const existing = runStates.get(userId);
    if (existing) return existing;
    const created: UserRunState = {
      generation: 0,
      queue: Promise.resolve(),
      controllers: new Set<AbortController>(),
      runIds: new Set<string>(),
    };
    runStates.set(userId, created);
    return created;
  }

  function cancelUserRuns(userId: string, reason: string): void {
    const runState = userRunState(userId);
    runState.generation += 1;
    for (const controller of runState.controllers) controller.abort();
    runState.controllers.clear();
    for (const runId of runState.runIds) {
      bus.publish(runId, { type: "error", message: reason, at: new Date().toISOString() });
      runOwners.delete(runId);
    }
    runState.runIds.clear();
    runState.queue = Promise.resolve();
  }

  async function userRecord(userId: string) {
    const data = await store.read();
    return data.users.find((candidate) => candidate.id === userId) ?? null;
  }

  async function roomCodeForUser(userId: string): Promise<RoomCodeRepository> {
    if (!workspaceRoot) return requireRoomCode(roomCode);
    const root = path.join(workspaceRoot, safePathSegment(userId));
    await mkdir(root, { recursive: true });
    return new RoomCodeRepository(root);
  }

  async function materializeActiveRoom(userId: string, code: RoomCodeRepository, config: RoomConfig): Promise<void> {
    const sceneSource = await activeRooms.getSceneSource(userId);
    await code.writeConfig(config);
    await code.writeSceneSource(sceneSource);
    await code.writeActiveSceneSource(sceneSource);
  }

  async function persistActiveScene(userId: string, code: RoomCodeRepository): Promise<void> {
    await activeRooms.saveSceneSource(userId, await code.readRawActiveScene());
  }

  async function resetActiveRoomForUser(userId: string, reason: string): Promise<RoomConfig> {
    cancelUserRuns(userId, reason);
    const activeConfig = await activeRooms.saveConfig(userId, freshRoomConfig());
    const sceneSource = await activeRooms.saveSceneSource(userId, freshSceneSource());
    const code = await roomCodeForUser(userId);
    await code.writeConfig(activeConfig);
    await code.writeSceneSource(sceneSource);
    await code.writeActiveSceneSource(sceneSource);
    return activeConfig;
  }
}

function requireRunner(runner: ArchitectRunner | undefined): ArchitectRunner {
  if (!runner) {
    throw new HttpError(503, "Architect runner is not available.");
  }
  return runner;
}

function requireCodexBridge(codex: CodexAuthBridge | undefined): CodexAuthBridge {
  if (!codex) {
    throw new HttpError(503, "Codex app-server bridge is not available.");
  }
  return codex;
}

function requireRoomCode(roomCode: RoomCodeRepository | undefined): RoomCodeRepository {
  if (!roomCode) {
    throw new HttpError(503, "Room code repository is not available.");
  }
  return roomCode;
}

function isSecureRequest(req: IncomingMessage): boolean {
  return firstHeaderValue(req.headers["x-forwarded-proto"]) === "https";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function mapCodexErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CodexAppServerUnavailableError) {
      throw new HttpError(503, "Codex is not available. Install or sign in to Codex, then try again.");
    }
    throw error;
  }
}

class HttpError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function isStaleCodexRefreshTokenError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("refresh token") && normalized.includes("already used");
}

async function serveStatic(res: ServerResponse, url: URL, staticRoot: string): Promise<void> {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = path.resolve(staticRoot, `.${pathname}`);
  const relative = path.relative(staticRoot, requested);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: "Static asset path is outside the build directory." });
    return;
  }

  try {
    const file = await readFile(requested);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType(requested));
    res.end(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && pathname !== "/index.html") {
      await serveStatic(res, new URL("/index.html", url), staticRoot);
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  }
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
