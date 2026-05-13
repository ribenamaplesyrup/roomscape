import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PublicUser } from "../../shared/api";
import type { DataStore, UserRecord } from "../storage/types";

export interface ChatGptAuthInput {
  accountId: string;
  email?: string;
  codexAuthRef?: string;
  planType?: string;
}

export class AuthService {
  public constructor(private readonly store: DataStore) {}

  /** Creates or refreshes a Roomscape session for a Codex-managed ChatGPT account. */
  public async authenticateWithChatGpt(input: ChatGptAuthInput): Promise<{ user: PublicUser; sessionId: string; rememberToken: string }> {
    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new Error("ChatGPT account id is required.");
    }

    const data = await this.store.read();
    const openAiAccountHash = fingerprintCredential(`chatgpt:${accountId}`);
    const rememberToken = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    let user = data.users.find((candidate) => candidate.openAiAccountHash === openAiAccountHash);
    const accountLabel = labelChatGptAccount(input.email, input.planType);
    if (user) {
      user.authMode = "chatgpt";
      user.openAiAccountLabel = accountLabel;
      user.accountLabel = accountLabel;
      if (input.codexAuthRef) user.codexAuthRef = input.codexAuthRef;
      user.rememberTokenHash = fingerprintCredential(`remember:${rememberToken}`);
      if (input.planType) user.planType = input.planType;
      user.updatedAt = now;
    } else {
      user = {
        id: randomUUID(),
        authMode: "chatgpt",
        openAiAccountHash,
        openAiAccountLabel: accountLabel,
        accountLabel,
        ...(input.codexAuthRef ? { codexAuthRef: input.codexAuthRef } : {}),
        rememberTokenHash: fingerprintCredential(`remember:${rememberToken}`),
        ...(input.planType ? { planType: input.planType } : {}),
        createdAt: now,
        updatedAt: now,
      };
      data.users.push(user);
    }
    const session = { id: randomUUID(), userId: user.id, createdAt: now };
    data.sessions.push(session);
    await this.store.write(data);
    return { user: toPublicUser(user), sessionId: session.id, rememberToken };
  }

  /** Recreates an app session for a browser that previously completed ChatGPT auth. */
  public async authenticateWithRememberedDevice(rememberToken: string | undefined): Promise<{ user: PublicUser; sessionId: string } | null> {
    if (!rememberToken) return null;
    const data = await this.store.read();
    const rememberTokenHash = fingerprintCredential(`remember:${rememberToken}`);
    const user = data.users.find((candidate) => candidate.rememberTokenHash === rememberTokenHash);
    if (!user) return null;
    const session = { id: randomUUID(), userId: user.id, createdAt: new Date().toISOString() };
    data.sessions.push(session);
    await this.store.write(data);
    return { user: toPublicUser(user), sessionId: session.id };
  }

  /** Resolves a session token into a public user profile. */
  public async userForSession(sessionId: string | undefined): Promise<PublicUser | null> {
    if (!sessionId) return null;
    const data = await this.store.read();
    const session = data.sessions.find((candidate) => candidate.id === sessionId);
    const user = session ? data.users.find((candidate) => candidate.id === session.userId) : undefined;
    return user ? toPublicUser(user) : null;
  }

  /** Deletes a session and forgets this browser's remembered ChatGPT device token. */
  public async logout(sessionId: string | undefined, rememberToken: string | undefined): Promise<void> {
    const data = await this.store.read();
    const session = sessionId ? data.sessions.find((candidate) => candidate.id === sessionId) : undefined;
    data.sessions = data.sessions.filter((session) => session.id !== sessionId);
    this.clearRememberedDevice(data.users, rememberToken, session?.userId);
    await this.store.write(data);
  }

  /** Forces a fresh Codex/ChatGPT device login for a user after token refresh failures. */
  public async invalidateCodexAuth(userId: string): Promise<void> {
    const data = await this.store.read();
    const user = data.users.find((candidate) => candidate.id === userId);
    if (!user) return;
    delete user.codexAuthRef;
    delete user.rememberTokenHash;
    user.updatedAt = new Date().toISOString();
    await this.store.write(data);
  }

  private clearRememberedDevice(users: UserRecord[], rememberToken: string | undefined, userId: string | undefined): void {
    if (!rememberToken && !userId) return;
    const rememberTokenHash = rememberToken ? fingerprintCredential(`remember:${rememberToken}`) : undefined;
    for (const user of users) {
      if (user.id !== userId && user.rememberTokenHash !== rememberTokenHash) continue;
      delete user.rememberTokenHash;
      user.updatedAt = new Date().toISOString();
    }
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  const accountLabel = user.accountLabel ?? user.openAiAccountLabel ?? "OpenAI account";
  return {
    id: user.id,
    authMode: user.authMode ?? "chatgpt",
    openAiAccountLabel: user.openAiAccountLabel ?? accountLabel,
    accountLabel,
    ...(user.planType ? { planType: user.planType } : {}),
  };
}

function fingerprintCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function labelChatGptAccount(email: string | undefined, planType: string | undefined): string {
  const plan = planType ? ` ${planType}` : "";
  return email ? `ChatGPT${plan} ${email}` : `ChatGPT${plan} account`;
}
