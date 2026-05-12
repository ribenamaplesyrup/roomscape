import type { RoomConfig } from "./room";

export interface PublicUser {
  id: string;
  openAiAccountLabel: string;
  architectName: string;
  architectDescription: string;
  isArchitectConfigured: boolean;
}

export interface SavedRoom {
  id: string;
  userId: string;
  name: string;
  config: RoomConfig;
  createdAt: string;
  updatedAt: string;
}

export type AgentEvent =
  | { type: "log"; message: string; at: string }
  | { type: "cost"; model: string; inputTokens: number; outputTokens: number; usd: number; totalUsd: number; at: string }
  | { type: "room-updated"; config: RoomConfig; at: string }
  | { type: "permission-request"; request: PermissionRequest; at: string }
  | { type: "complete"; runId: string; at: string }
  | { type: "error"; message: string; at: string };

export interface PermissionRequest {
  id: string;
  reason: string;
  requestedPath: string;
  sandboxRoot: string;
  command?: string;
}

export interface AgentRunStart {
  runId: string;
}
