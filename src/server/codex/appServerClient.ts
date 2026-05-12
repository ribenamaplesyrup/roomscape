import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { ChatGptLoginStart, ChatGptUsage } from "../../shared/api";

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type ChatGptLoginResult = ChatGptLoginStart;

interface CodexAccountReadResult {
  account: null | {
    type: "apiKey" | "chatgpt" | "chatgptAuthTokens";
    email?: string;
    planType?: string;
    accountId?: string;
    chatgptAccountId?: string;
  };
  requiresOpenaiAuth: boolean;
}

export interface CodexRateLimitsResult {
  rateLimits?: ChatGptUsage["rateLimits"];
  rateLimitsByLimitId?: ChatGptUsage["rateLimitsByLimitId"];
}

export interface CodexChatGptAccount {
  accountId: string;
  email?: string;
  codexAuthRef?: string;
  planType?: string;
}

export class CodexAppServerUnavailableError extends Error {}

interface LoginCompletedNotification {
  loginId: string | null;
  success: boolean;
  error: string | null;
}

export interface CodexAuthBridge {
  startChatGptLogin(): Promise<ChatGptLoginStart>;
  completeChatGptLogin(loginId: string): Promise<CodexChatGptAccount | null>;
  readChatGptAccount(): Promise<CodexChatGptAccount | null>;
  readRateLimits(codexAuthRef?: string): Promise<CodexRateLimitsResult>;
  codexHomeForAuthRef?(codexAuthRef: string | undefined): string | undefined;
}

export class CodexAppServerClient implements CodexAuthBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly events = new EventEmitter();
  private nextId = 1;
  private initialized: Promise<void> | null = null;

  public constructor(
    private readonly command = "codex",
    private readonly options: { env?: NodeJS.ProcessEnv; loginType?: "chatgpt" | "chatgptDeviceCode"; codexAuthRef?: string } = {},
  ) {}

  /** Starts the Codex-managed ChatGPT OAuth browser flow and returns the auth URL. */
  public async startChatGptLogin(): Promise<ChatGptLoginResult> {
    const result = await this.request("account/login/start", { type: this.options.loginType ?? "chatgpt" });
    if (!isChatGptLoginResult(result)) {
      throw new Error("Codex app-server returned an unexpected ChatGPT login response.");
    }
    return result;
  }

  /** Polls the Codex auth state and consumes login-completed notifications when available. */
  public async completeChatGptLogin(loginId: string): Promise<CodexChatGptAccount | null> {
    const completion = await this.waitForLoginCompletion(loginId, 1_500);
    if (completion && !completion.success) {
      throw new Error(completion.error ?? "ChatGPT login did not complete.");
    }
    return this.readChatGptAccount();
  }

  /** Reads the current Codex account and normalizes the ChatGPT account shape for Roomscape. */
  public async readChatGptAccount(): Promise<CodexChatGptAccount | null> {
    const result = await this.request("account/read", { refreshToken: true });
    if (!isAccountReadResult(result)) {
      return null;
    }
    const account = result.account;
    if (!account || !isChatGptAccountType(account.type)) {
      return null;
    }
    return {
      accountId: account.accountId ?? account.chatgptAccountId ?? account.email ?? "chatgpt",
      ...(account.email ? { email: account.email } : {}),
      ...(this.options.codexAuthRef ? { codexAuthRef: this.options.codexAuthRef } : {}),
      ...(account.planType ? { planType: account.planType } : {}),
    };
  }

  /** Reads ChatGPT rate limits when Codex exposes them for the authenticated account. */
  public async readRateLimits(): Promise<CodexRateLimitsResult> {
    const result = await this.request("account/rateLimits/read", {});
    return result as CodexRateLimitsResult;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    const id = this.nextId++;
    const message = { method, id, params };
    const response = new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.events.off(String(id), onResponse);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
      }, 60_000);
      const onResponse = (rpcResponse: RpcResponse) => {
        clearTimeout(timeout);
        if (rpcResponse.error) {
          reject(new Error(rpcResponse.error.message));
        } else {
          resolve(rpcResponse);
        }
      };
      this.events.once(String(id), onResponse);
    });
    this.proc!.stdin.write(`${JSON.stringify(message)}\n`);
    return (await response).result;
  }

  private async ensureStarted(): Promise<void> {
    if (this.initialized) {
      return this.initialized;
    }
    this.initialized = this.start();
    return this.initialized;
  }

  private async start(): Promise<void> {
    try {
      this.proc = spawn(this.command, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.options.env },
      });
    } catch (error) {
      throw new CodexAppServerUnavailableError(error instanceof Error ? error.message : "Unable to start Codex app-server.");
    }

    this.proc.once("error", (error) => {
      this.events.emit("startup-error", error);
    });
    this.proc.once("exit", () => {
      this.proc = null;
      this.initialized = null;
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      let message: Partial<RpcResponse> & { method?: string; params?: unknown };
      try {
        message = JSON.parse(line) as Partial<RpcResponse> & { method?: string; params?: unknown };
      } catch {
        return;
      }
      if (typeof message.id === "number") {
        this.events.emit(String(message.id), message);
      }
      if (message.method === "account/login/completed" && isLoginCompletedNotification(message.params)) {
        this.events.emit(loginEventName(message.params.loginId), message.params);
      }
    });

    await this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    const startupError = new Promise<never>((_, reject) => {
      this.events.once("startup-error", (error) => {
        reject(new CodexAppServerUnavailableError(error instanceof Error ? error.message : "Unable to start Codex app-server."));
      });
    });
    const initialized = this.initializeHandshake();
    await Promise.race([startupError, initialized]);
  }

  private async initializeHandshake(): Promise<void> {
    const id = this.nextId++;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out initializing Codex app-server.")), 30_000);
      this.events.once(String(id), (rpcResponse: RpcResponse) => {
        clearTimeout(timeout);
        rpcResponse.error ? reject(new Error(rpcResponse.error.message)) : resolve(rpcResponse);
      });
    });
    this.proc!.stdin.write(`${JSON.stringify({
      method: "initialize",
      id,
      params: {
        clientInfo: {
          name: "roomscape",
          title: "Roomscape",
          version: "0.1.0",
        },
      },
    })}\n`);
    await response;
    this.proc!.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  }

  private async waitForLoginCompletion(loginId: string, timeoutMs: number): Promise<LoginCompletedNotification | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.events.off(loginEventName(loginId), onComplete);
        resolve(null);
      }, timeoutMs);
      const onComplete = (notification: LoginCompletedNotification) => {
        clearTimeout(timeout);
        resolve(notification);
      };
      this.events.once(loginEventName(loginId), onComplete);
    });
  }
}

function isChatGptLoginResult(value: unknown): value is ChatGptLoginResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatGptLoginStart>;
  if (candidate.type === "chatgpt") {
    return Boolean(candidate.loginId && "authUrl" in candidate && candidate.authUrl);
  }
  if (candidate.type === "chatgptDeviceCode") {
    return Boolean(candidate.loginId && "verificationUrl" in candidate && candidate.verificationUrl && "userCode" in candidate && candidate.userCode);
  }
  return false;
}

function isAccountReadResult(value: unknown): value is CodexAccountReadResult {
  return Boolean(value && typeof value === "object" && "account" in value);
}

function isChatGptAccountType(value: unknown): boolean {
  return value === "chatgpt" || value === "chatgptAuthTokens";
}

function isLoginCompletedNotification(value: unknown): value is LoginCompletedNotification {
  return Boolean(value && typeof value === "object" && "success" in value && "loginId" in value);
}

function loginEventName(loginId: string | null): string {
  return `login:${loginId ?? "none"}`;
}
