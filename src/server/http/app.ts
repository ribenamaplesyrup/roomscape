import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { freshRoomConfig, type RoomConfig } from "../../shared/room";
import { AuthService } from "../auth/service";
import { AgentRunBus, type ArchitectRunner } from "../agent/architectRunner";
import { RoomCodeRepository } from "../agent/roomCodeRepository";
import { CodexAppServerUnavailableError, type CodexAuthBridge } from "../codex/appServerClient";
import { RoomRepository } from "../storage/roomRepository";
import type { DataStore } from "../storage/types";
import { readCookie, setSessionCookie, clearSessionCookie } from "./cookies";
import { readJson, sendJson } from "./json";

interface AppDeps {
  store: DataStore;
  runner: ArchitectRunner;
  bus: AgentRunBus;
  roomCode?: RoomCodeRepository;
  codex?: CodexAuthBridge;
  vite?: ViteDevServer;
  staticRoot?: string;
}

export function createApp({ store, runner, bus, roomCode, codex, vite, staticRoot }: AppDeps) {
  const auth = new AuthService(store);
  const rooms = new RoomRepository(store);
  let activeConfig: RoomConfig = freshRoomConfig();
  let runQueue: Promise<void> = Promise.resolve();

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
      await auth.logout(readCookie(req, "roomscape_session"));
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      sendJson(res, 200, { user: await auth.userForSession(readCookie(req, "roomscape_session")) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/chatgpt/start") {
      const bridge = requireCodexBridge(codex);
      const login = await mapCodexErrors(() => bridge.startChatGptLogin());
      sendJson(res, 200, { loginId: login.loginId, authUrl: login.authUrl });
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
      setSessionCookie(res, result.sessionId);
      sendJson(res, 200, { status: "authenticated", user: result.user });
      return;
    }

    const user = await requireUser(req);
    if (req.method === "GET" && url.pathname === "/api/usage") {
      if (user.authMode !== "chatgpt" || !codex) {
        sendJson(res, 200, { usage: null });
        return;
      }
      sendJson(res, 200, { usage: await mapCodexErrors(() => codex.readRateLimits()) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/rooms") {
      sendJson(res, 200, { rooms: await rooms.listForUser(user.id) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson<{ name: string; config?: RoomConfig }>(req);
      const code = requireRoomCode(roomCode);
      const sceneSource = await code.readRawActiveScene();
      sendJson(res, 201, { room: await rooms.save(user.id, body.name, body.config ?? activeConfig, sceneSource) });
      return;
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === "GET" && roomMatch?.[1]) {
      const room = await rooms.get(user.id, roomMatch[1]);
      if (!room) throw new HttpError(404, "Room not found.");
      activeConfig = room.config;
      const code = requireRoomCode(roomCode);
      const normalizedSceneSource = code.normalizeSceneSource(room.sceneSource);
      await code.writeSceneSource(normalizedSceneSource);
      const validationErrors = code.validateSceneSource(normalizedSceneSource);
      if (validationErrors.length > 0) {
        throw new HttpError(422, `Saved scene is invalid:\n${validationErrors.join("\n")}`);
      }
      await code.writeActiveSceneSource(normalizedSceneSource);
      sendJson(res, 200, { room });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/active-room") {
      sendJson(res, 200, { config: activeConfig });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/active-room/reset") {
      activeConfig = freshRoomConfig();
      const code = requireRoomCode(roomCode);
      await code.writeConfig(activeConfig);
      await code.writeFreshScene();
      sendJson(res, 200, { config: activeConfig });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent/runs") {
      const body = await readJson<{ prompt: string; model: string; currentConfig?: RoomConfig }>(req);
      const runId = randomUUID();
      const currentConfig = body.currentConfig ?? activeConfig;
      bus.publish(runId, { type: "log", message: "Queued room edit.", at: new Date().toISOString() });
      runQueue = runQueue
        .catch(() => undefined)
        .then(() => runner.run(
          {
            runId,
            prompt: body.prompt,
            model: body.model,
            currentConfig,
          },
          (event) => {
            if (event.type === "room-updated") activeConfig = event.config;
            bus.publish(runId, event);
          },
        ));
      sendJson(res, 202, { runId });
      return;
    }
    const eventMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch?.[1]) {
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

export function roomscapeDataPath(cwd = process.cwd()): string {
  return path.join(cwd, ".roomscape", "data.json");
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
