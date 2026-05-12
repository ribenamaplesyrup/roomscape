import { randomUUID } from "node:crypto";
import type { PublicUser } from "../../shared/api";
import { encryptSecret, hashPassword, verifyPassword } from "./crypto";
import type { DataStore, UserRecord } from "../storage/types";

export interface RegisterInput {
  username: string;
  password: string;
  openAiKey: string;
  architectPersona: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export class AuthService {
  public constructor(private readonly store: DataStore) {}

  /** Registers a new Roomscape user and creates a session in one transaction. */
  public async register(input: RegisterInput): Promise<{ user: PublicUser; sessionId: string }> {
    const username = input.username.trim();
    if (username.length < 3) {
      throw new Error("Username must be at least 3 characters.");
    }
    if (input.password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if (!input.openAiKey.trim()) {
      throw new Error("OpenAI credentials are required.");
    }

    const data = await this.store.read();
    if (data.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Username is already registered.");
    }

    const password = hashPassword(input.password);
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      username,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      encryptedOpenAiKey: encryptSecret(input.openAiKey.trim()),
      architectPersona: input.architectPersona.trim() || "Careful spatial collaborator",
      createdAt: now,
    };
    const session = { id: randomUUID(), userId: user.id, createdAt: now };
    data.users.push(user);
    data.sessions.push(session);
    await this.store.write(data);
    return { user: toPublicUser(user), sessionId: session.id };
  }

  /** Authenticates a user with username and password and returns a fresh session. */
  public async login(input: LoginInput): Promise<{ user: PublicUser; sessionId: string }> {
    const data = await this.store.read();
    const user = data.users.find((candidate) => candidate.username.toLowerCase() === input.username.trim().toLowerCase());
    if (!user || !verifyPassword(input.password, user.passwordSalt, user.passwordHash)) {
      throw new Error("Invalid username or password.");
    }
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

  /** Deletes a session without touching the user's rooms or credentials. */
  public async logout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const data = await this.store.read();
    data.sessions = data.sessions.filter((session) => session.id !== sessionId);
    await this.store.write(data);
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    architectPersona: user.architectPersona,
  };
}
