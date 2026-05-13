import { describe, expect, it } from "vitest";
import { emptyRoomConfig } from "../src/shared/room";
import { MemoryStore } from "../src/server/storage/memoryStore";
import { RoomRepository } from "../src/server/storage/roomRepository";

describe("room repository", () => {
  it("saves and loads room configurations per user", async () => {
    const repo = new RoomRepository(new MemoryStore());
    const room = await repo.save("user-a", "First room", emptyRoomConfig, "export const roomTitle = 'First';");
    await repo.save("user-b", "Other room", emptyRoomConfig, "export const roomTitle = 'Other';");

    expect(await repo.get("user-a", room.id)).toMatchObject({ name: "First room", sceneSource: "export const roomTitle = 'First';" });
    expect(await repo.get("user-b", room.id)).toBeNull();
    expect(await repo.listForUser("user-a")).toHaveLength(1);
  });

  it("overwrites an existing room when the same user saves the same title", async () => {
    const repo = new RoomRepository(new MemoryStore());
    const first = await repo.save("user-a", "First room", { ...emptyRoomConfig, name: "Draft" }, "export const roomTitle = 'First';");
    const second = await repo.save("user-a", "  first   ROOM  ", { ...emptyRoomConfig, name: "Updated draft" }, "export const roomTitle = 'Second';");

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe("first   ROOM");
    expect(second.config.name).toBe("first   ROOM");
    expect(second.sceneSource).toBe("export const roomTitle = 'Second';");
    expect(await repo.listForUser("user-a")).toHaveLength(1);
  });

  it("does not overwrite another user's room with the same title", async () => {
    const repo = new RoomRepository(new MemoryStore());
    const first = await repo.save("user-a", "Shared title", emptyRoomConfig, "export const roomTitle = 'A';");
    const second = await repo.save("user-b", "shared title", emptyRoomConfig, "export const roomTitle = 'B';");

    expect(second.id).not.toBe(first.id);
    expect(await repo.listForUser("user-a")).toHaveLength(1);
    expect(await repo.listForUser("user-b")).toHaveLength(1);
  });

  it("deletes only the current user's saved room", async () => {
    const repo = new RoomRepository(new MemoryStore());
    const room = await repo.save("user-a", "Private room", emptyRoomConfig, "export const roomTitle = 'A';");

    await expect(repo.delete("user-b", room.id)).resolves.toBe(false);
    expect(await repo.get("user-a", room.id)).toMatchObject({ name: "Private room" });

    await expect(repo.delete("user-a", room.id)).resolves.toBe(true);
    expect(await repo.get("user-a", room.id)).toBeNull();
  });
});
