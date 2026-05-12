import { describe, expect, it } from "vitest";
import { AuthService } from "../src/server/auth/service";
import { MemoryStore } from "../src/server/storage/memoryStore";

describe("auth service", () => {
  it("requires OpenAI credentials during registration and stores no plaintext password", async () => {
    const service = new AuthService(new MemoryStore());
    await expect(service.register({
      username: "sean",
      password: "long-enough",
      openAiKey: "",
      architectPersona: "Pastel Concierge",
    })).rejects.toThrow("OpenAI credentials");

    const store = new MemoryStore();
    const registered = await new AuthService(store).register({
      username: "sean",
      password: "long-enough",
      openAiKey: "sk-test",
      architectPersona: "Pastel Concierge",
    });
    const data = await store.read();
    expect(registered.user.username).toBe("sean");
    expect(data.users[0]?.passwordHash).not.toContain("long-enough");
    expect(data.users[0]?.encryptedOpenAiKey).not.toContain("sk-test");
  });

  it("logs in with a valid password and rejects an invalid password", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store);
    await service.register({
      username: "mira",
      password: "correct-password",
      openAiKey: "sk-test",
      architectPersona: "Institutional Gothic",
    });

    await expect(service.login({ username: "mira", password: "wrong-password" })).rejects.toThrow("Invalid");
    const result = await service.login({ username: "mira", password: "correct-password" });
    expect(await service.userForSession(result.sessionId)).toMatchObject({ username: "mira" });
  });
});
