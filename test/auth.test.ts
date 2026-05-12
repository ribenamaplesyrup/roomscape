import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth/service";
import { MemoryStore } from "../src/server/storage/memoryStore";

describe("auth service", () => {
  it("prompts for architect profile after ChatGPT authentication", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const result = await service.authenticateWithChatGpt({
      accountId: "acct-chatgpt",
    });

    expect(result.user.isArchitectConfigured).toBe(false);
    await expect(service.updateArchitectProfile(result.sessionId, {
      architectName: "",
      architectDescription: "Institutional Gothic with patient spatial logic.",
    })).rejects.toThrow("Architect name");

    const user = await service.updateArchitectProfile(result.sessionId, {
      architectName: "Institutional Gothic",
      architectDescription: "Patient, vaulted, stone-minded spatial collaborator.",
    });
    expect(user).toMatchObject({
      architectName: "Institutional Gothic",
      isArchitectConfigured: true,
    });
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
      isArchitectConfigured: false,
    });
    expect(data.users[0]).not.toHaveProperty("encryptedOpenAiKey");
    expect(data.users[0]).not.toHaveProperty("passwordHash");
    expect(await service.userForSession(result.sessionId)).toEqual(result.user);
  });
});
