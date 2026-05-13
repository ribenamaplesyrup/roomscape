import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PermissionRequest } from "../../shared/api";

export interface SandboxDecision {
  allowed: boolean;
  normalizedPath: string;
  permissionRequest?: PermissionRequest;
}

/** Checks whether an agent-requested path remains inside the active generated-room workspace. */
export function evaluateSandboxPath(sandboxRoot: string, requestedPath: string, reason: string, command?: string): SandboxDecision {
  const root = path.resolve(sandboxRoot);
  const normalizedPath = path.resolve(root, requestedPath);
  const relative = path.relative(root, normalizedPath);
  const allowed = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (allowed) {
    return { allowed, normalizedPath };
  }

  const permissionRequest: PermissionRequest = {
    id: randomUUID(),
    reason,
    requestedPath: normalizedPath,
    sandboxRoot: root,
    ...(command ? { command } : {}),
  };

  return {
    allowed,
    normalizedPath,
    permissionRequest,
  };
}
