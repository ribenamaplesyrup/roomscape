import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth/service";
import { MemoryStore } from "../src/server/storage/memoryStore";

describe("auth service", () => {
  it("authenticates ChatGPT users without requiring an architect profile", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const result = await service.authenticateWithChatGpt({
      accountId: "acct-chatgpt",
    });

    expect(result.user).toMatchObject({ authMode: "chatgpt" });
    expect(result.user).not.toHaveProperty("architectName");
    expect(result.user).not.toHaveProperty("architectDescription");
    expect(result.user).not.toHaveProperty("isArchitectConfigured");
  });

  it("creates a local session for a Codex-managed ChatGPT account without storing an API key", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const result = await service.authenticateWithChatGpt({
      accountId: "acct-chatgpt",
      email: "designer@example.com",
      planType: "plus",
    });

    const data = await store.read();
    expect(result.user).toMatchObject({
      authMode: "chatgpt",
      openAiAccountLabel: "ChatGPT plus designer@example.com",
      planType: "plus",
    });
    expect(data.users[0]).not.toHaveProperty("encryptedOpenAiKey");
    expect(data.users[0]).not.toHaveProperty("passwordHash");
    expect(await service.userForSession(result.sessionId)).toEqual(result.user);
  });

  it("creates a hosted OAuth session keyed by provider account id", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const result = await service.authenticateWithOAuthProvider({
      provider: "github",
      accountId: "123",
      username: "designer",
      name: "Room Designer",
      email: "designer@example.com",
    });

    expect(result.user).toMatchObject({
      authMode: "github",
      accountLabel: "GitHub Room Designer",
    });
    const again = await service.authenticateWithOAuthProvider({
      provider: "github",
      accountId: "123",
      username: "designer-renamed",
    });
    expect(again.user.id).toBe(result.user.id);
    expect(await service.userForSession(again.sessionId)).toEqual(again.user);
  });

  it("consumes OAuth state only once and only for the original redirect URI", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const state = await service.createOAuthState("github", "https://roomscape.test/api/auth/github/callback");

    await expect(service.consumeOAuthState("github", state, "https://other.test/api/auth/github/callback")).resolves.toBe(false);
    await expect(service.consumeOAuthState("github", state, "https://roomscape.test/api/auth/github/callback")).resolves.toBe(false);

    const nextState = await service.createOAuthState("github", "https://roomscape.test/api/auth/github/callback");
    await expect(service.consumeOAuthState("github", nextState, "https://roomscape.test/api/auth/github/callback")).resolves.toBe(true);
    await expect(service.consumeOAuthState("github", nextState, "https://roomscape.test/api/auth/github/callback")).resolves.toBe(false);
  });
});
