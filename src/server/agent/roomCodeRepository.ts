import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RoomConfig } from "../../shared/room";
import { evaluateSandboxPath } from "./sandboxPolicy";

export class SandboxViolationError extends Error {
  public constructor(public readonly request: NonNullable<ReturnType<typeof evaluateSandboxPath>["permissionRequest"]>) {
    super("Agent attempted to access a path outside the active room sandbox.");
  }
}

export class RoomCodeRepository {
  public constructor(
    public readonly sandboxRoot: string,
    private readonly configFile = "roomConfig.ts",
  ) {}

  /** Writes the active room config as TypeScript so Vite can hot-reload the scene module. */
  public async writeConfig(config: RoomConfig): Promise<string> {
    const decision = evaluateSandboxPath(this.sandboxRoot, this.configFile, "Write generated room configuration.");
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    await mkdir(path.dirname(decision.normalizedPath), { recursive: true });
    const body = [
      'import type { RoomConfig } from "../../../src/shared/room";',
      "",
      "export const roomConfig = " + JSON.stringify(config, null, 2) + " satisfies RoomConfig;",
      "",
    ].join("\n");
    await writeFile(decision.normalizedPath, body, "utf8");
    return decision.normalizedPath;
  }

  /** Reads the generated config module as text for audit and debugging surfaces. */
  public async readRawConfig(): Promise<string> {
    const decision = evaluateSandboxPath(this.sandboxRoot, this.configFile, "Read generated room configuration.");
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    return readFile(decision.normalizedPath, "utf8");
  }

  /** Deliberately exposes policy checks for agent tools before touching disk. */
  public ensureInsideSandbox(requestedPath: string, reason: string, command?: string): string {
    const decision = evaluateSandboxPath(this.sandboxRoot, requestedPath, reason, command);
    if (!decision.allowed || !decision.normalizedPath) {
      throw new SandboxViolationError(decision.permissionRequest!);
    }
    return decision.normalizedPath;
  }
}
