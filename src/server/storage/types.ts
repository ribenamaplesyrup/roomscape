import type { RoomConfig } from "../../shared/room";
import type { AuthMode } from "../../shared/api";

export interface UserRecord {
  id: string;
  authMode: AuthMode;
  openAiAccountHash?: string;
  openAiAccountLabel?: string;
  accountLabel?: string;
  codexAuthRef?: string;
  planType?: string;
  createdAt: string;
  updatedAt: string;
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
  sceneSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveRoomRecord {
  userId: string;
  config: RoomConfig;
  updatedAt: string;
}

export interface RoomscapeData {
  users: UserRecord[];
  sessions: SessionRecord[];
  rooms: RoomRecord[];
  activeRooms: ActiveRoomRecord[];
}

export interface DataStore {
  read(): Promise<RoomscapeData>;
  write(data: RoomscapeData): Promise<void>;
}

export const emptyData = (): RoomscapeData => ({
  users: [],
  sessions: [],
  rooms: [],
  activeRooms: [],
});
