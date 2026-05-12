import type { RoomConfig } from "./room";

export type AuthMode = "chatgpt";

export interface PublicUser {
  id: string;
  authMode: AuthMode;
  openAiAccountLabel: string;
  planType?: string;
}

export interface SavedRoom {
  id: string;
  userId: string;
  name: string;
  config: RoomConfig;
  sceneSource: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentEvent =
  | { type: "log"; message: string; at: string }
  | { type: "cost"; model: string; inputTokens: number; outputTokens: number; usd: number; totalUsd: number; at: string }
  | { type: "room-updated"; config: RoomConfig; at: string }
  | { type: "scene-updated"; at: string }
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

export interface ChatGptLoginStart {
  loginId: string;
  authUrl: string;
}

export interface ChatGptAuthStatus {
  status: "pending" | "authenticated";
  user?: PublicUser;
}

export interface ChatGptUsage {
  rateLimits?: ChatGptRateLimitBucket;
  rateLimitsByLimitId?: Record<string, ChatGptRateLimitBucket>;
}

export interface ChatGptRateLimitBucket {
  limitId: string;
  limitName?: string | null;
  primary?: {
    usedPercent: number;
    windowDurationMins: number;
    resetsAt: number;
  };
  rateLimitReachedType?: string | null;
}
