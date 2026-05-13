import { describe, expect, it } from "vitest";
import { ActiveRoomRepository } from "../src/server/storage/activeRoomRepository";
import { MemoryStore } from "../src/server/storage/memoryStore";
import { emptyRoomConfig, freshRoomConfig } from "../src/shared/room";

describe("active room repository", () => {
  it("stores active room config per user", async () => {
    const repo = new ActiveRoomRepository(new MemoryStore());
    const userAConfig = { ...emptyRoomConfig, name: "User A room" };
    const userBConfig = { ...emptyRoomConfig, name: "User B room" };

    await repo.saveConfig("user-a", userAConfig);
    await repo.saveConfig("user-b", userBConfig);

    expect(await repo.getConfig("user-a")).toMatchObject({ name: "User A room" });
    expect(await repo.getConfig("user-b")).toMatchObject({ name: "User B room" });
  });

  it("returns a fresh room when the user has no active room yet", async () => {
    const repo = new ActiveRoomRepository(new MemoryStore());

    expect(await repo.getConfig("new-user")).toEqual(freshRoomConfig());
  });
});
