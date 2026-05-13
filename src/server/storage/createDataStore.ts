import { roomscapeDataPath } from "../config/paths";
import { JsonStore } from "./jsonStore";
import { PostgresStore } from "./postgresStore";
import type { DataStore } from "./types";

export function createDataStore(cwd: string, env: NodeJS.ProcessEnv): DataStore {
  if (env.DATABASE_URL) {
    return new PostgresStore(env.DATABASE_URL, { env });
  }
  return new JsonStore(roomscapeDataPath(cwd, env));
}
