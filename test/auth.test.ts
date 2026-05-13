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

});
