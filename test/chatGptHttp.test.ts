import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRunBus, type ArchitectRunner } from "../src/server/agent/architectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import { createApp, roomscapeDataPath } from "../src/server/http/app";
import { MemoryStore } from "../src/server/storage/memoryStore";
import type { CodexAuthBridge, CodexChatGptAccount, CodexRateLimitsResult } from "../src/server/codex/appServerClient";
import { chatGptLoginFlow, roomscapeCodexAuthRoot } from "../src/server/codex/userAuthCoordinator";
import type { ChatGptLoginStart } from "../src/shared/api";
import { emptyRoomConfig } from "../src/shared/room";

class FakeCodexBridge implements CodexAuthBridge {
  public account: CodexChatGptAccount | null = null;
  public completedLoginIds = new Set<string>();
  public loginStart: ChatGptLoginStart = { type: "chatgpt", loginId: "login-1", authUrl: "https://chatgpt.com/auth" };

  /** Starts a deterministic fake login for the HTTP integration test. */
  public async startChatGptLogin() {
    return this.loginStart;
  }

  /** Completes only after the requested login id has been marked completed. */
  public async completeChatGptLogin(loginId: string): Promise<CodexChatGptAccount | null> {
    return this.completedLoginIds.has(loginId) ? this.account : null;
  }

  /** Reads the account already known to the fake Codex app-server. */
  public async readChatGptAccount(): Promise<CodexChatGptAccount | null> {
    return this.account;
  }

  /** Returns a stable usage bucket shaped like the Codex app-server response. */
  public async readRateLimits(): Promise<CodexRateLimitsResult> {
    return {
      rateLimits: {
        limitId: "codex",
        primary: {
          usedPercent: 25,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
      },
    };
  }

  public codexHomeForAuthRef(codexAuthRef: string | undefined): string | undefined {
    return codexAuthRef ? `/auth/${codexAuthRef}` : undefined;
  }
}

const noopRunner: ArchitectRunner = {
  async run() {},
};

describe("ChatGPT auth HTTP flow", () => {
  it("serves a healthcheck without requiring authentication", async () => {
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(await mkdtemp(path.join(os.tmpdir(), "roomscape-http-health-"))),
      codex: new FakeCodexBridge(),
    });

    const health = await request<{ ok: boolean }>(handler, "GET", "/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });

  it("allows deployment configuration to move the JSON store path", () => {
    expect(roomscapeDataPath("/app", { ROOMSCAPE_DATA_PATH: "/data/roomscape.json" })).toBe("/data/roomscape.json");
    expect(roomscapeDataPath("/app", { ROOMSCAPE_DATA_DIR: "/data" })).toBe(path.join("/data", "data.json"));
    expect(roomscapeDataPath("/app", {})).toBe(path.join("/app", ".roomscape", "data.json"));
  });

  it("uses hosted device-code ChatGPT login defaults in production", () => {
    expect(chatGptLoginFlow({ NODE_ENV: "production" })).toBe("device_code");
    expect(chatGptLoginFlow({ NODE_ENV: "production", ROOMSCAPE_CHATGPT_LOGIN_FLOW: "browser" })).toBe("browser");
    expect(roomscapeCodexAuthRoot("/app", { ROOMSCAPE_DATA_DIR: "/data" })).toBe(path.join("/data", "codex-auth"));
  });

  it("creates a session from an existing Codex ChatGPT account when popups are unavailable", async () => {
    const codex = new FakeCodexBridge();
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-existing-"));
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(roomRoot),
      codex,
    });

    const pending = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/existing");
    expect(pending.status).toBe(202);
    expect(pending.body.status).toBe("pending");

    codex.account = { accountId: "acct-chatgpt", email: "designer@example.com", planType: "plus" };
    const completed = await request<{ status: string; user: { authMode: string } }>(handler, "POST", "/api/auth/chatgpt/existing");
    expect(completed.body.status).toBe("authenticated");
    expect(completed.body.user.authMode).toBe("chatgpt");
    expect(completed.headers["set-cookie"]).toContain("roomscape_session=");
  });

  it("starts Codex ChatGPT login, creates a session after completion, and exposes usage", async () => {
    const codex = new FakeCodexBridge();
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-"));
    const roomCode = new RoomCodeRepository(roomRoot);
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode,
      codex,
    });

    const started = await request<{ type: string; loginId: string; authUrl: string }>(handler, "POST", "/api/auth/chatgpt/start");
    expect(started.body).toEqual({ type: "chatgpt", loginId: "login-1", authUrl: "https://chatgpt.com/auth" });

    const pending = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    expect(pending.body.status).toBe("pending");

    codex.completedLoginIds.add("login-1");
    codex.account = { accountId: "acct-chatgpt", email: "designer@example.com", planType: "plus" };
    const completed = await request<{ status: string; user: { authMode: string } }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    expect(completed.body.status).toBe("authenticated");
    expect(completed.body.user.authMode).toBe("chatgpt");
    expect(completed.body.user).not.toHaveProperty("isArchitectConfigured");
    const sessionCookie = completed.headers["set-cookie"];
    expect(sessionCookie).toContain("roomscape_device=");

    const usage = await request<{ usage: CodexRateLimitsResult }>(handler, "GET", "/api/usage", undefined, sessionCookie);
    expect(usage.body.usage.rateLimits?.primary?.usedPercent).toBe(25);

    const reset = await request<{ config: { name: string; objects: unknown[] } }>(handler, "POST", "/api/active-room/reset", undefined, sessionCookie);
    expect(reset.body.config).toMatchObject({ name: "Bare Room", objects: [] });
    await expect(readFile(path.join(roomRoot, "roomConfig.ts"), "utf8")).resolves.toContain('name": "Bare Room"');
    await expect(readFile(path.join(roomRoot, "activeRoomScene.ts"), "utf8")).resolves.toContain("export function buildRoom");

    const saved = await request<{ room: { id: string; sceneSource: string } }>(handler, "POST", "/api/rooms", { name: "Saved scene" }, sessionCookie);
    expect(saved.body.room.sceneSource).toContain("export function buildRoom");

    await writeFile(path.join(roomRoot, "activeRoomScene.ts"), "export const roomTitle = 'Changed';\n", "utf8");
    const loaded = await request<{ room: { id: string; config: { name: string } } }>(handler, "GET", `/api/rooms/${saved.body.room.id}`, undefined, sessionCookie);
    expect(loaded.body.room.id).toBe(saved.body.room.id);
    expect(loaded.body.room.config.name).toBe("Saved scene");
    await expect(readFile(path.join(roomRoot, "roomConfig.ts"), "utf8")).resolves.toContain('name": "Saved scene"');
    await expect(readFile(path.join(roomRoot, "activeRoomScene.ts"), "utf8")).resolves.toContain("export function buildRoom");
  });

  it("can restore a signed-out browser session without requesting a fresh device code", async () => {
    const codex = new FakeCodexBridge();
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-remembered-"));
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(roomRoot),
      codex,
    });

    codex.completedLoginIds.add("login-1");
    codex.account = { accountId: "acct-chatgpt", codexAuthRef: "auth-a", email: "designer@example.com" };
    const completed = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    const cookies = completed.headers["set-cookie"];
    await request<{ ok: boolean }>(handler, "POST", "/api/auth/logout", undefined, cookies);

    codex.account = null;
    const restored = await request<{ status: string; user: { authMode: string } }>(handler, "POST", "/api/auth/chatgpt/existing", undefined, cookies);
    expect(restored.body.status).toBe("authenticated");
    expect(restored.body.user.authMode).toBe("chatgpt");
    expect(restored.headers["set-cookie"]).toContain("roomscape_session=");
  });

  it("returns device-code login details for hosted ChatGPT auth", async () => {
    const codex = new FakeCodexBridge();
    codex.loginStart = {
      type: "chatgptDeviceCode",
      loginId: "login-device",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    };
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(await mkdtemp(path.join(os.tmpdir(), "roomscape-http-device-"))),
      codex,
    });

    const started = await request<ChatGptLoginStart>(handler, "POST", "/api/auth/chatgpt/start");
    expect(started.body).toEqual(codex.loginStart);
  });

  it("passes the authenticated user's Codex home into agent runs", async () => {
    const codex = new FakeCodexBridge();
    const runner = new RecordingRunner();
    const handler = createApp({
      store: new MemoryStore(),
      runner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(await mkdtemp(path.join(os.tmpdir(), "roomscape-http-codex-home-"))),
      codex,
    });

    codex.account = { accountId: "acct-chatgpt", codexAuthRef: "auth-a", email: "designer@example.com" };
    codex.completedLoginIds.add("login-1");
    const completed = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    await request<{ runId: string }>(handler, "POST", "/api/agent/runs", { prompt: "Add a chair", model: "gpt-5.5" }, completed.headers["set-cookie"]);

    const input = await runner.waitForRun();
    expect(input.codexHome).toBe("/auth/auth-a");
  });

  it("keeps active room config scoped to the authenticated user", async () => {
    const codex = new FakeCodexBridge();
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-active-"));
    const roomCode = new RoomCodeRepository(roomRoot);
    await roomCode.writeFreshScene();
    const handler = createApp({
      store: new MemoryStore(),
      runner: noopRunner,
      bus: new AgentRunBus(),
      roomCode,
      codex,
    });

    codex.account = { accountId: "acct-a", email: "a@example.com" };
    const userA = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/existing");
    const userACookie = userA.headers["set-cookie"];
    const userAConfig = { ...emptyRoomConfig, name: "User A private world" };
    const saved = await request<{ room: { id: string } }>(handler, "POST", "/api/rooms", { name: "A world", config: userAConfig }, userACookie);
    await request<{ room: { id: string } }>(handler, "GET", `/api/rooms/${saved.body.room.id}`, undefined, userACookie);

    codex.account = { accountId: "acct-b", email: "b@example.com" };
    const userB = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/existing");
    const userBCookie = userB.headers["set-cookie"];
    const userBActive = await request<{ config: { name: string } }>(handler, "GET", "/api/active-room", undefined, userBCookie);
    const userAActive = await request<{ config: { name: string } }>(handler, "GET", "/api/active-room", undefined, userACookie);

    expect(userBActive.body.config.name).toBe("Bare Room");
    expect(userAActive.body.config.name).toBe("A world");
  });

  it("cancels active and queued room edits when requested, reset, or the user signs out", async () => {
    const codex = new FakeCodexBridge();
    codex.account = { accountId: "acct-chatgpt", email: "designer@example.com", planType: "plus" };
    codex.completedLoginIds.add("login-1");
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-runs-"));
    const runner = new HangingRunner();
    const handler = createApp({
      store: new MemoryStore(),
      runner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(roomRoot),
      codex,
    });
    const completed = await request<{ status: string; user: { authMode: string } }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    const sessionCookie = completed.headers["set-cookie"];

    await request<{ runId: string }>(handler, "POST", "/api/agent/runs", { prompt: "Add a chair", model: "gpt-5.5" }, sessionCookie);
    await runner.waitForStart();
    expect(runner.lastSignal?.aborted).toBe(false);

    await request<{ ok: boolean }>(handler, "POST", "/api/agent/runs/cancel", undefined, sessionCookie);
    expect(runner.lastSignal?.aborted).toBe(true);

    runner.resetStartWaiter();
    await request<{ runId: string }>(handler, "POST", "/api/agent/runs", { prompt: "Add a lamp", model: "gpt-5.5" }, sessionCookie);
    await runner.waitForStart();
    expect(runner.lastSignal?.aborted).toBe(false);

    await request<{ config: { name: string } }>(handler, "POST", "/api/active-room/reset", undefined, sessionCookie);
    expect(runner.lastSignal?.aborted).toBe(true);

    runner.resetStartWaiter();
    await request<{ runId: string }>(handler, "POST", "/api/agent/runs", { prompt: "Add a table", model: "gpt-5.5" }, sessionCookie);
    await runner.waitForStart();
    expect(runner.lastSignal?.aborted).toBe(false);

    await request<{ ok: boolean }>(handler, "POST", "/api/auth/logout", undefined, sessionCookie);
    expect(runner.lastSignal?.aborted).toBe(true);
  });

  it("does not let one user cancel another user's active room edit", async () => {
    const codex = new FakeCodexBridge();
    const roomRoot = await mkdtemp(path.join(os.tmpdir(), "roomscape-http-run-owners-"));
    const runner = new HangingRunner();
    const handler = createApp({
      store: new MemoryStore(),
      runner,
      bus: new AgentRunBus(),
      roomCode: new RoomCodeRepository(roomRoot),
      codex,
    });

    codex.account = { accountId: "acct-a", email: "a@example.com" };
    const userA = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/existing");
    const userACookie = userA.headers["set-cookie"];
    await request<{ runId: string }>(handler, "POST", "/api/agent/runs", { prompt: "Add a chair", model: "gpt-5.5" }, userACookie);
    await runner.waitForStart();

    codex.account = { accountId: "acct-b", email: "b@example.com" };
    const userB = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/existing");
    await request<{ ok: boolean }>(handler, "POST", "/api/agent/runs/cancel", undefined, userB.headers["set-cookie"]);
    expect(runner.lastSignal?.aborted).toBe(false);

    await request<{ ok: boolean }>(handler, "POST", "/api/agent/runs/cancel", undefined, userACookie);
    expect(runner.lastSignal?.aborted).toBe(true);
  });
});

class HangingRunner implements ArchitectRunner {
  public lastSignal: AbortSignal | undefined;
  private resolveStarted: (() => void) | undefined;
  private started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  /** Records run start and then stays pending until the app cancels it. */
  public async run(input: Parameters<ArchitectRunner["run"]>[0]): Promise<void> {
    this.lastSignal = input.signal;
    this.resolveStarted?.();
    await new Promise(() => undefined);
  }

  public waitForStart(): Promise<void> {
    return this.started;
  }

  public resetStartWaiter(): void {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }
}

class RecordingRunner implements ArchitectRunner {
  private resolveRun: ((input: Parameters<ArchitectRunner["run"]>[0]) => void) | undefined;
  private readonly runStarted = new Promise<Parameters<ArchitectRunner["run"]>[0]>((resolve) => {
    this.resolveRun = resolve;
  });

  public async run(input: Parameters<ArchitectRunner["run"]>[0]): Promise<void> {
    this.resolveRun?.(input);
  }

  public waitForRun(): Promise<Parameters<ArchitectRunner["run"]>[0]> {
    return this.runStarted;
  }
}

type AppHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

interface TestResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

async function request<T>(handler: AppHandler, method: string, url: string, body?: unknown, cookie?: string, headersOverride: Record<string, string> = {}): Promise<TestResponse<T>> {
  const req = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = {
    host: "127.0.0.1",
    ...(cookie ? { cookie } : {}),
    ...headersOverride,
  };

  const headers: Record<string, string> = {};
  let payload = "";
  const res = {
    statusCode: 200,
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join("; ") : value;
    },
    end(chunk?: string) {
      payload += chunk ?? "";
    },
  } as unknown as ServerResponse;

  await handler(req, res);
  return {
    status: res.statusCode,
    headers,
    body: JSON.parse(payload || "{}") as T,
  };
}
