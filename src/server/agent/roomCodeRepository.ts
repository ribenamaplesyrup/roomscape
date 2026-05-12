import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RoomConfig, RoomObject, RoomObjectKind } from "../../shared/room";
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

  /** Reads the generated TypeScript module back into the server's typed room config. */
  public async readConfig(): Promise<RoomConfig> {
    const raw = await this.readRawConfig();
    const match = raw.match(/export\s+const\s+roomConfig\s*=\s*([\s\S]*?)\s+satisfies\s+RoomConfig\s*;/);
    if (!match?.[1]) {
      throw new Error("Active room config does not export a RoomConfig literal.");
    }
    return parseRoomConfigLiteral(match[1]);
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

function parseRoomConfigLiteral(value: string): RoomConfig {
  const parsed = JSON.parse(value) as unknown;
  if (!isRoomConfig(parsed)) {
    throw new Error("Active room config is not a valid RoomConfig.");
  }
  return parsed;
}

function isRoomConfig(value: unknown): value is RoomConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as RoomConfig;
  return typeof candidate.name === "string"
    && isPalette(candidate.palette)
    && Array.isArray(candidate.objects)
    && candidate.objects.every(isRoomObject)
    && typeof candidate.updatedAt === "string";
}

function isPalette(value: unknown): value is RoomConfig["palette"] {
  if (!value || typeof value !== "object") return false;
  const palette = value as RoomConfig["palette"];
  return typeof palette.wall === "string"
    && typeof palette.floor === "string"
    && typeof palette.ceiling === "string"
    && typeof palette.accent === "string";
}

function isRoomObject(value: unknown): value is RoomObject {
  if (!value || typeof value !== "object") return false;
  const object = value as RoomObject;
  return typeof object.id === "string"
    && isRoomObjectKind(object.kind)
    && typeof object.label === "string"
    && typeof object.color === "string"
    && isVector3(object.position)
    && isVector3(object.scale)
    && (object.intensity === undefined || typeof object.intensity === "number");
}

function isRoomObjectKind(value: unknown): value is RoomObjectKind {
  return value === "cube" || value === "table" || value === "sofa" || value === "column" || value === "light";
}

function isVector3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number");
}
