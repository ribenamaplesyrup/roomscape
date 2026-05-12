import { createHash, randomUUID } from "node:crypto";
import type { AuthMode } from "../../shared/api";
import type { PublicUser } from "../../shared/api";
import type { DataStore, UserRecord } from "../storage/types";

export interface ChatGptAuthInput {
  accountId: string;
  email?: string;
  planType?: string;
}

export interface OAuthProviderAuthInput {
  provider: "github";
  accountId: string;
  username: string;
  email?: string;
  name?: string;
}

export class AuthService {
  public constructor(private readonly store: DataStore) {}

  /** Creates or refreshes a Roomscape session for a Codex-managed ChatGPT account. */
  public async authenticateWithChatGpt(input: ChatGptAuthInput): Promise<{ user: PublicUser; sessionId: string }> {
    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new Error("ChatGPT account id is required.");
    }

    const data = await this.store.read();
    const openAiAccountHash = fingerprintCredential(`chatgpt:${accountId}`);
    const now = new Date().toISOString();
    let user = data.users.find((candidate) => candidate.openAiAccountHash === openAiAccountHash || candidate.authProviderAccountHash === openAiAccountHash);
    const accountLabel = labelChatGptAccount(input.email, input.planType);
    if (user) {
      user.authMode = "chatgpt";
      user.authProvider = "chatgpt";
      user.authProviderAccountHash = openAiAccountHash;
      user.openAiAccountLabel = accountLabel;
      user.accountLabel = accountLabel;
      if (input.planType) user.planType = input.planType;
      user.updatedAt = now;
    } else {
      user = {
        id: randomUUID(),
        authMode: "chatgpt",
        authProvider: "chatgpt",
        authProviderAccountHash: openAiAccountHash,
        openAiAccountHash,
        openAiAccountLabel: accountLabel,
        accountLabel,
        ...(input.planType ? { planType: input.planType } : {}),
        createdAt: now,
        updatedAt: now,
      };
      data.users.push(user);
    }
    const session = { id: randomUUID(), userId: user.id, createdAt: now };
    data.sessions.push(session);
    await this.store.write(data);
    return { user: toPublicUser(user), sessionId: session.id };
  }

  /** Creates or refreshes a hosted OAuth session for a production web auth provider. */
  public async authenticateWithOAuthProvider(input: OAuthProviderAuthInput): Promise<{ user: PublicUser; sessionId: string }> {
    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new Error(`${input.provider} account id is required.`);
    }

    const data = await this.store.read();
    const authProviderAccountHash = fingerprintCredential(`${input.provider}:${accountId}`);
    const now = new Date().toISOString();
    const accountLabel = labelOAuthAccount(input);
    let user = data.users.find((candidate) => candidate.authProvider === input.provider && candidate.authProviderAccountHash === authProviderAccountHash);
    if (user) {
      user.authMode = input.provider;
      user.authProvider = input.provider;
      user.accountLabel = accountLabel;
      user.updatedAt = now;
    } else {
      user = {
        id: randomUUID(),
        authMode: input.provider,
        authProvider: input.provider,
        authProviderAccountHash,
        accountLabel,
        createdAt: now,
        updatedAt: now,
      };
      data.users.push(user);
    }
    const session = { id: randomUUID(), userId: user.id, createdAt: now };
    data.sessions.push(session);
    await this.store.write(data);
    return { user: toPublicUser(user), sessionId: session.id };
  }

  public async createOAuthState(provider: AuthMode, redirectUri: string): Promise<string> {
    const data = await this.store.read();
    const state = {
      id: randomUUID(),
      provider,
      redirectUri,
      createdAt: new Date().toISOString(),
    };
    data.oauthStates = pruneOAuthStates(data.oauthStates ?? []);
    data.oauthStates.push(state);
    await this.store.write(data);
    return state.id;
  }

  public async consumeOAuthState(provider: AuthMode, stateId: string, redirectUri: string): Promise<boolean> {
    const data = await this.store.read();
    const states = pruneOAuthStates(data.oauthStates ?? []);
    const match = states.find((state) => state.id === stateId && state.provider === provider && state.redirectUri === redirectUri);
    data.oauthStates = states.filter((state) => state.id !== stateId);
    await this.store.write(data);
    return Boolean(match);
  }

  /** Resolves a session token into a public user profile. */
  public async userForSession(sessionId: string | undefined): Promise<PublicUser | null> {
    if (!sessionId) return null;
    const data = await this.store.read();
    const session = data.sessions.find((candidate) => candidate.id === sessionId);
    const user = session ? data.users.find((candidate) => candidate.id === session.userId) : undefined;
    return user ? toPublicUser(user) : null;
  }

  /** Deletes a session without touching the user's rooms or credentials. */
  public async logout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const data = await this.store.read();
    data.sessions = data.sessions.filter((session) => session.id !== sessionId);
    await this.store.write(data);
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

function labelOAuthAccount(input: OAuthProviderAuthInput): string {
  const display = input.name?.trim() || input.email?.trim() || input.username.trim();
  return input.provider === "github" ? `GitHub ${display}` : display;
}

function pruneOAuthStates<T extends { createdAt: string }>(states: T[]): T[] {
  const maxAgeMs = 10 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  return states.filter((state) => Date.parse(state.createdAt) >= cutoff);
}
