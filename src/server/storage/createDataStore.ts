import { roomscapeDataPath } from "../http/app";
import { JsonStore } from "./jsonStore";
import type { DataStore } from "./types";

export function createDataStore(cwd: string, env: NodeJS.ProcessEnv): DataStore {
  if (env.DATABASE_URL) {
    throw new Error("DATABASE_URL is configured, but the PostgreSQL DataStore is not implemented yet. Use ROOMSCAPE_DATA_DIR for the interim Railway volume-backed JSON store.");
  }
  return new JsonStore(roomscapeDataPath(cwd, env));
}
