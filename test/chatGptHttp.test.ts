import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRunBus, type ArchitectRunner } from "../src/server/agent/architectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import { createApp } from "../src/server/http/app";
import { MemoryStore } from "../src/server/storage/memoryStore";
import type { CodexAuthBridge, CodexChatGptAccount, CodexRateLimitsResult } from "../src/server/codex/appServerClient";

class FakeCodexBridge implements CodexAuthBridge {
  public account: CodexChatGptAccount | null = null;

  /** Starts a deterministic fake login for the HTTP integration test. */
  public async startChatGptLogin() {
    return { loginId: "login-1", authUrl: "https://chatgpt.com/auth" };
  }

  /** Completes when the test has supplied a fake Codex ChatGPT account. */
  public async completeChatGptLogin(): Promise<CodexChatGptAccount | null> {
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
}

const noopRunner: ArchitectRunner = {
  async run() {},
};

describe("ChatGPT auth HTTP flow", () => {
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

    const started = await request<{ loginId: string; authUrl: string }>(handler, "POST", "/api/auth/chatgpt/start");
    expect(started.body).toEqual({ loginId: "login-1", authUrl: "https://chatgpt.com/auth" });

    const pending = await request<{ status: string }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    expect(pending.body.status).toBe("pending");

    codex.account = { accountId: "acct-chatgpt", email: "designer@example.com", planType: "plus" };
    const completed = await request<{ status: string; user: { authMode: string } }>(handler, "POST", "/api/auth/chatgpt/complete", { loginId: "login-1" });
    expect(completed.body.status).toBe("authenticated");
    expect(completed.body.user.authMode).toBe("chatgpt");
    expect(completed.body.user).not.toHaveProperty("isArchitectConfigured");
    const sessionCookie = completed.headers["set-cookie"];

    const usage = await request<{ usage: CodexRateLimitsResult }>(handler, "GET", "/api/usage", undefined, sessionCookie);
    expect(usage.body.usage.rateLimits?.primary?.usedPercent).toBe(25);

    const reset = await request<{ config: { name: string; objects: unknown[] } }>(handler, "POST", "/api/active-room/reset", undefined, sessionCookie);
    expect(reset.body.config).toMatchObject({ name: "Bare Room", objects: [] });
    await expect(readFile(path.join(roomRoot, "roomConfig.ts"), "utf8")).resolves.toContain('name": "Bare Room"');
    await expect(readFile(path.join(roomRoot, "activeRoomScene.ts"), "utf8")).resolves.toContain("export function buildRoom");

    const saved = await request<{ room: { id: string; sceneSource: string } }>(handler, "POST", "/api/rooms", { name: "Saved scene" }, sessionCookie);
    expect(saved.body.room.sceneSource).toContain("export function buildRoom");

    await writeFile(path.join(roomRoot, "activeRoomScene.ts"), "export const roomTitle = 'Changed';\n", "utf8");
    const loaded = await request<{ room: { id: string } }>(handler, "GET", `/api/rooms/${saved.body.room.id}`, undefined, sessionCookie);
    expect(loaded.body.room.id).toBe(saved.body.room.id);
    await expect(readFile(path.join(roomRoot, "activeRoomScene.ts"), "utf8")).resolves.toContain("export function buildRoom");
  });

  it("cancels active and queued room edits when requested, reset, or the user signs out", async () => {
    const codex = new FakeCodexBridge();
    codex.account = { accountId: "acct-chatgpt", email: "designer@example.com", planType: "plus" };
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

type AppHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

interface TestResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

async function request<T>(handler: AppHandler, method: string, url: string, body?: unknown, cookie?: string): Promise<TestResponse<T>> {
  const req = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = {
    host: "127.0.0.1",
    ...(cookie ? { cookie } : {}),
  };

  const headers: Record<string, string> = {};
  let payload = "";
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
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
