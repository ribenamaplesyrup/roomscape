import { createHash, randomUUID } from "node:crypto";
import type { PublicUser } from "../../shared/api";
import type { DataStore, UserRecord } from "../storage/types";

export interface ArchitectProfileInput {
  architectName: string;
  architectDescription: string;
}

export interface ChatGptAuthInput {
  accountId: string;
  email?: string;
  planType?: string;
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
    let user = data.users.find((candidate) => candidate.openAiAccountHash === openAiAccountHash);
    if (user) {
      user.authMode = "chatgpt";
      user.openAiAccountLabel = labelChatGptAccount(input.email, input.planType);
      if (input.planType) user.planType = input.planType;
      user.updatedAt = now;
    } else {
      user = {
        id: randomUUID(),
        authMode: "chatgpt",
        openAiAccountHash,
        openAiAccountLabel: labelChatGptAccount(input.email, input.planType),
        ...(input.planType ? { planType: input.planType } : {}),
        architectName: "",
        architectDescription: "",
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

  /** Stores the user's Architect persona after OpenAI authentication succeeds. */
  public async updateArchitectProfile(sessionId: string | undefined, input: ArchitectProfileInput): Promise<PublicUser> {
    if (!sessionId) {
      throw new Error("Authentication required.");
    }
    const architectName = input.architectName.trim();
    const architectDescription = input.architectDescription.trim();
    if (!architectName) {
      throw new Error("Architect name is required.");
    }
    if (!architectDescription) {
      throw new Error("Architect description is required.");
    }

    const data = await this.store.read();
    const session = data.sessions.find((candidate) => candidate.id === sessionId);
    const user = session ? data.users.find((candidate) => candidate.id === session.userId) : undefined;
    if (!user) {
      throw new Error("Authentication required.");
    }
    user.architectName = architectName;
    user.architectDescription = architectDescription;
    user.updatedAt = new Date().toISOString();
    await this.store.write(data);
    return toPublicUser(user);
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
  const architectName = user.architectName ?? "";
  const architectDescription = user.architectDescription ?? "";
  return {
    id: user.id,
    authMode: user.authMode ?? "chatgpt",
    openAiAccountLabel: user.openAiAccountLabel ?? "OpenAI account",
    ...(user.planType ? { planType: user.planType } : {}),
    architectName,
    architectDescription,
    isArchitectConfigured: Boolean(architectName && architectDescription),
  };
}

function fingerprintCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function labelChatGptAccount(email: string | undefined, planType: string | undefined): string {
  const plan = planType ? ` ${planType}` : "";
  return email ? `ChatGPT${plan} ${email}` : `ChatGPT${plan} account`;
}
