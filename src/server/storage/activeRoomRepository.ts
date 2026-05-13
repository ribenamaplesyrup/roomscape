import { freshSceneSource } from "../agent/roomCodeRepository";
import { freshRoomConfig, type RoomConfig } from "../../shared/room";
import type { ActiveRoomRecord, DataStore } from "./types";

export class ActiveRoomRepository {
  public constructor(private readonly store: DataStore) {}

  /** Returns the active room config owned by this user, or a fresh bare room. */
  public async getConfig(userId: string): Promise<RoomConfig> {
    const data = await this.store.read();
    const activeRoom = data.activeRooms.find((candidate) => candidate.userId === userId);
    return activeRoom ? structuredClone(activeRoom.config) : freshRoomConfig();
  }

  /** Stores the active room config for one user without touching other users' active rooms. */
  public async saveConfig(userId: string, config: RoomConfig): Promise<RoomConfig> {
    const data = await this.store.read();
    const now = new Date().toISOString();
    const storedConfig = { ...config, updatedAt: now };
    const existing = data.activeRooms.find((candidate) => candidate.userId === userId);
    if (existing) {
      existing.config = storedConfig;
      existing.updatedAt = now;
    } else {
      const activeRoom: ActiveRoomRecord = { userId, config: storedConfig, sceneSource: freshSceneSource(), updatedAt: now };
      data.activeRooms.push(activeRoom);
    }
    await this.store.write(data);
    return structuredClone(storedConfig);
  }

  /** Returns the active validated scene source owned by this user, or a fresh bare room. */
  public async getSceneSource(userId: string): Promise<string> {
    const data = await this.store.read();
    const activeRoom = data.activeRooms.find((candidate) => candidate.userId === userId);
    return activeRoom?.sceneSource ?? freshSceneSource();
  }

  /** Stores the active validated scene source for one user without touching other users. */
  public async saveSceneSource(userId: string, sceneSource: string): Promise<string> {
    const data = await this.store.read();
    const now = new Date().toISOString();
    const existing = data.activeRooms.find((candidate) => candidate.userId === userId);
    if (existing) {
      existing.sceneSource = sceneSource;
      existing.updatedAt = now;
    } else {
      data.activeRooms.push({ userId, config: freshRoomConfig(), sceneSource, updatedAt: now });
    }
    await this.store.write(data);
    return sceneSource;
  }
}
