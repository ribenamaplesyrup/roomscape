import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  CodexAppServerClient,
  type CodexAuthBridge,
  type CodexChatGptAccount,
  type CodexRateLimitsResult,
} from "./appServerClient";
import type { ChatGptLoginStart } from "../../shared/api";

interface PendingLogin {
  authRef: string;
  client: CodexAppServerClient;
}

export type ChatGptLoginFlow = "browser" | "device_code";

export interface CodexUserAuthCoordinatorOptions {
  authRoot: string;
  command?: string;
  loginFlow?: ChatGptLoginFlow;
}

/** Creates isolated Codex app-server auth homes for hosted ChatGPT sign-in. */
export class CodexUserAuthCoordinator implements CodexAuthBridge {
  private readonly command: string;
  private readonly loginFlow: ChatGptLoginFlow;
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly clientsByAuthRef = new Map<string, CodexAppServerClient>();
  private readonly sharedClient: CodexAppServerClient;

  public constructor(private readonly options: CodexUserAuthCoordinatorOptions) {
    this.command = options.command ?? "codex";
    this.loginFlow = options.loginFlow ?? "browser";
    this.sharedClient = new CodexAppServerClient(this.command);
  }

  public async startChatGptLogin(): Promise<ChatGptLoginStart> {
    if (this.loginFlow === "browser") {
      return this.sharedClient.startChatGptLogin();
    }

    const authRef = randomUUID();
    const client = await this.clientForAuthRef(authRef, "chatgptDeviceCode");
    const login = await client.startChatGptLogin();
    this.pendingLogins.set(login.loginId, { authRef, client });
    return login;
  }

  public async completeChatGptLogin(loginId: string): Promise<CodexChatGptAccount | null> {
    if (this.loginFlow === "browser") {
      return this.sharedClient.completeChatGptLogin(loginId);
    }

    const pending = this.pendingLogins.get(loginId);
    if (!pending) return null;
    const account = await pending.client.completeChatGptLogin(loginId);
    if (!account) return null;
    this.pendingLogins.delete(loginId);
    this.clientsByAuthRef.set(pending.authRef, pending.client);
    return { ...account, codexAuthRef: pending.authRef };
  }

  public async readChatGptAccount(): Promise<CodexChatGptAccount | null> {
    if (this.loginFlow === "device_code") return null;
    return this.sharedClient.readChatGptAccount();
  }

  public async readRateLimits(codexAuthRef?: string): Promise<CodexRateLimitsResult> {
    if (!codexAuthRef) return this.sharedClient.readRateLimits();
    const client = await this.clientForAuthRef(codexAuthRef, "chatgptDeviceCode");
    return client.readRateLimits();
  }

  public codexHomeForAuthRef(codexAuthRef: string | undefined): string | undefined {
    if (!codexAuthRef || !isSafeAuthRef(codexAuthRef)) return undefined;
    return path.join(this.options.authRoot, codexAuthRef);
  }

  private async clientForAuthRef(authRef: string, loginType: "chatgpt" | "chatgptDeviceCode"): Promise<CodexAppServerClient> {
    const existing = this.clientsByAuthRef.get(authRef);
    if (existing) return existing;
    const codexHome = this.codexHomeForAuthRef(authRef);
    if (!codexHome) {
      throw new Error("Invalid Codex auth reference.");
    }
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    const client = new CodexAppServerClient(this.command, {
      codexAuthRef: authRef,
      env: { CODEX_HOME: codexHome },
      loginType,
    });
    this.clientsByAuthRef.set(authRef, client);
    return client;
  }
}

export function chatGptLoginFlow(env: NodeJS.ProcessEnv): ChatGptLoginFlow {
  const configured = env.ROOMSCAPE_CHATGPT_LOGIN_FLOW?.trim().toLowerCase();
  if (configured === "browser" || configured === "device_code") return configured;
  return env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT || env.RAILWAY_SERVICE_ID ? "device_code" : "browser";
}

export function roomscapeCodexAuthRoot(cwd: string, env: NodeJS.ProcessEnv): string {
  if (env.ROOMSCAPE_CODEX_AUTH_DIR) return env.ROOMSCAPE_CODEX_AUTH_DIR;
  if (env.ROOMSCAPE_DATA_DIR) return path.join(env.ROOMSCAPE_DATA_DIR, "codex-auth");
  return path.join(cwd, ".roomscape", "codex-auth");
}

function isSafeAuthRef(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
