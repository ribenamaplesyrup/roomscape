import { describe, expect, it } from "vitest";
import { emptyRoomConfig } from "../src/shared/room";
import { MemoryStore } from "../src/server/storage/memoryStore";
import { RoomRepository } from "../src/server/storage/roomRepository";

describe("room repository", () => {
  it("saves and loads room configurations per user", async () => {
    const repo = new RoomRepository(new MemoryStore());
    const room = await repo.save("user-a", "First room", emptyRoomConfig);
    await repo.save("user-b", "Other room", emptyRoomConfig);

    expect(await repo.get("user-a", room.id)).toMatchObject({ name: "First room" });
    expect(await repo.get("user-b", room.id)).toBeNull();
    expect(await repo.listForUser("user-a")).toHaveLength(1);
  });
});
