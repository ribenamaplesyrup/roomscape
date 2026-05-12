import type { RoomConfig } from "../../shared/room";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  encryptedOpenAiKey: string;
  architectPersona: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
}

export interface RoomRecord {
  id: string;
  userId: string;
  name: string;
  config: RoomConfig;
  createdAt: string;
  updatedAt: string;
}

export interface RoomscapeData {
  users: UserRecord[];
  sessions: SessionRecord[];
  rooms: RoomRecord[];
}

export interface DataStore {
  read(): Promise<RoomscapeData>;
  write(data: RoomscapeData): Promise<void>;
}

export const emptyData = (): RoomscapeData => ({
  users: [],
  sessions: [],
  rooms: [],
});
