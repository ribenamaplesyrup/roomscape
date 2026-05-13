import { randomUUID } from "node:crypto";
import type { SavedRoom } from "../../shared/api";
import type { RoomConfig } from "../../shared/room";
import type { DataStore, RoomRecord } from "./types";

export class RoomRepository {
  public constructor(private readonly store: DataStore) {}

  /** Lists only the rooms owned by the authenticated user. */
  public async listForUser(userId: string): Promise<SavedRoom[]> {
    const data = await this.store.read();
    return data.rooms.filter((room) => room.userId === userId).map(toSavedRoom);
  }

  /** Saves a room snapshot for the user who owns the current session. */
  public async save(userId: string, name: string, config: RoomConfig, sceneSource: string): Promise<SavedRoom> {
    const data = await this.store.read();
    const now = new Date().toISOString();
    const roomName = name.trim() || config.name || "Untitled room";
    const existingRoom = data.rooms.find((room) => room.userId === userId && roomNameKey(room.name) === roomNameKey(roomName));
    if (existingRoom) {
      existingRoom.name = roomName;
      existingRoom.config = { ...config, name: roomName, updatedAt: now };
      existingRoom.sceneSource = sceneSource;
      existingRoom.updatedAt = now;
      await this.store.write(data);
      return toSavedRoom(existingRoom);
    }

    const room: RoomRecord = {
      id: randomUUID(),
      userId,
      name: roomName,
      config: { ...config, name: roomName, updatedAt: now },
      sceneSource,
      createdAt: now,
      updatedAt: now,
    };
    data.rooms.push(room);
    await this.store.write(data);
    return toSavedRoom(room);
  }

  /** Returns a single room only if it belongs to the current user. */
  public async get(userId: string, roomId: string): Promise<SavedRoom | null> {
    const data = await this.store.read();
    const room = data.rooms.find((candidate) => candidate.id === roomId && candidate.userId === userId);
    return room ? toSavedRoom(room) : null;
  }

  /** Deletes a saved room only when it belongs to the current user. */
  public async delete(userId: string, roomId: string): Promise<boolean> {
    const data = await this.store.read();
    const existingCount = data.rooms.length;
    data.rooms = data.rooms.filter((candidate) => candidate.id !== roomId || candidate.userId !== userId);
    if (data.rooms.length === existingCount) return false;
    await this.store.write(data);
    return true;
  }
}

function toSavedRoom(room: RoomRecord): SavedRoom {
  return structuredClone(room);
}

function roomNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
