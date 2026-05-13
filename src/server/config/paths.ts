import path from "node:path";

export function roomscapeDataPath(cwd = process.cwd(), env = process.env): string {
  if (env.ROOMSCAPE_DATA_PATH) return env.ROOMSCAPE_DATA_PATH;
  if (env.ROOMSCAPE_DATA_DIR) return path.join(env.ROOMSCAPE_DATA_DIR, "data.json");
  return path.join(cwd, ".roomscape", "data.json");
}

export function roomscapeWorkspaceRoot(cwd = process.cwd(), env = process.env): string {
  if (env.ROOMSCAPE_WORKSPACE_DIR) return env.ROOMSCAPE_WORKSPACE_DIR;
  if (env.ROOMSCAPE_DATA_DIR) return path.join(env.ROOMSCAPE_DATA_DIR, "workspaces");
  return path.join(cwd, ".roomscape", "workspaces");
}
