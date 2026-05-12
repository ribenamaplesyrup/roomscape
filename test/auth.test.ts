import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth/service";
import { MemoryStore } from "../src/server/storage/memoryStore";

describe("auth service", () => {
  it("requires OpenAI credentials and stores no plaintext credential", async () => {
    const service = new AuthService(new MemoryStore());
    await expect(service.authenticateWithOpenAi({
      openAiKey: "",
    })).rejects.toThrow("OpenAI credentials");

    const store = new MemoryStore();
    const authenticated = await new AuthService(store).authenticateWithOpenAi({
      openAiKey: "sk-test",
    });
    const data = await store.read();
    expect(authenticated.user.openAiAccountLabel).toContain("...test");
    expect(authenticated.user.authMode).toBe("apiKey");
    expect(data.users[0]?.encryptedOpenAiKey).not.toContain("sk-test");
    expect(data.users[0]).not.toHaveProperty("passwordHash");
  });

  it("prompts for architect profile after OpenAI authentication", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    const result = await service.authenticateWithOpenAi({
      openAiKey: "sk-test",
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
});
