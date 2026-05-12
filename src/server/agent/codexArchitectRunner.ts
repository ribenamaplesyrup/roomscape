import { Codex, type ThreadEvent, type ThreadOptions, type TurnOptions, type Usage } from "@openai/codex-sdk";
import type { AgentEvent } from "../../shared/api";
import type { ArchitectRunInput, ArchitectRunner } from "./architectRunner";
import { RoomCodeRepository, SandboxViolationError } from "./roomCodeRepository";
import { evaluateSandboxPath } from "./sandboxPolicy";

interface CodexThread {
  runStreamed(input: string, turnOptions?: TurnOptions): Promise<{ events: AsyncIterable<ThreadEvent> }>;
}

interface CodexThreadFactory {
  startThread(options: ThreadOptions): CodexThread;
}

export interface CodexSdkArchitectRunnerOptions {
  codex?: CodexThreadFactory;
  maxRepairAttempts?: number;
}

/** Runs the Architect through the Codex SDK while keeping writes scoped to the active room sandbox. */
export class CodexSdkArchitectRunner implements ArchitectRunner {
  private readonly codex: CodexThreadFactory;
  private readonly maxRepairAttempts: number;

  public constructor(
    private readonly roomCode: RoomCodeRepository,
    options: CodexSdkArchitectRunnerOptions = {},
  ) {
    this.codex = options.codex ?? new Codex();
    this.maxRepairAttempts = options.maxRepairAttempts ?? 1;
  }

  /** Streams Codex work logs, validates sandbox file changes, and reloads the generated room config. */
  public async run(input: ArchitectRunInput, emit: (event: AgentEvent) => void): Promise<void> {
    try {
      emit(log(`Starting Codex Three.js scene edit with ${input.model}.`));
      throwIfAborted(input.signal);
      this.preflightPrompt(input.prompt);
      const currentScene = await this.roomCode.readRawScene();
      const lastGoodScene = await this.roomCode.readRawActiveScene();
      throwIfAborted(input.signal);

      const thread = this.codex.startThread({
        model: input.model,
        workingDirectory: this.roomCode.sandboxRoot,
        skipGitRepoCheck: true,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      });
      const initialTurn = await thread.runStreamed(buildArchitectPrompt(input, currentScene), turnOptions(input.signal));
      if (await this.streamTurn(initialTurn.events, emit, input.signal)) return;
      throwIfAborted(input.signal);

      const sceneSource = await this.validateOrRepairScene(thread, input, emit, currentScene, lastGoodScene);
      if (!sceneSource) return;
      throwIfAborted(input.signal);
      await this.roomCode.writeActiveSceneSource(sceneSource);
      emit({ type: "scene-updated", at: new Date().toISOString() });
      emit({ type: "complete", runId: input.runId, at: new Date().toISOString() });
    } catch (error) {
      if (error instanceof RunAbortedError) {
        emit({ type: "error", message: "Room edit cancelled.", at: new Date().toISOString() });
        return;
      }
      if (error instanceof SandboxViolationError) {
        emit({ type: "permission-request", request: error.request, at: new Date().toISOString() });
        return;
      }
      if (isLikelySandboxError(error)) {
        const request = evaluateSandboxPath(this.roomCode.sandboxRoot, "../blocked", sandboxErrorMessage(error), "codex sandbox denial").permissionRequest!;
        emit({ type: "permission-request", request, at: new Date().toISOString() });
        return;
      }
      emit({ type: "error", message: error instanceof Error ? error.message : "Unknown Codex runner error.", at: new Date().toISOString() });
    }
  }

  private async validateOrRepairScene(
    thread: CodexThread,
    input: ArchitectRunInput,
    emit: (event: AgentEvent) => void,
    originalScene: string,
    lastGoodScene: string,
  ): Promise<string | null> {
    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      throwIfAborted(input.signal);
      const sceneSource = await this.roomCode.readRawScene();
      const normalizedSource = this.roomCode.normalizeSceneSource(sceneSource);
      if (normalizedSource !== sceneSource) {
        await this.roomCode.writeSceneSource(normalizedSource);
        emit(log("Cleaned unsafe Three.js namespace type annotations before validation."));
      }
      throwIfAborted(input.signal);
      const validationErrors = [
        ...this.roomCode.validateSceneSource(normalizedSource),
        ...validateTargetedEditScope(input.prompt, originalScene, normalizedSource),
      ];
      if (validationErrors.length === 0) {
        return normalizedSource;
      }
      if (attempt >= this.maxRepairAttempts) {
        await this.roomCode.writeSceneSource(lastGoodScene);
        emit({ type: "error", message: `Generated scene did not pass validation after repair:\n${validationErrors.join("\n")}`, at: new Date().toISOString() });
        return null;
      }

      emit(log(`Generated scene failed validation. Asking Codex to repair it without changing the user intent.\n${validationErrors.join("\n")}`));
      const repairTurn = await thread.runStreamed(buildRepairPrompt(input, sceneSource, validationErrors), turnOptions(input.signal));
      if (await this.streamTurn(repairTurn.events, emit, input.signal)) {
        return null;
      }
    }
    return null;
  }

  private async streamTurn(events: AsyncIterable<ThreadEvent>, emit: (event: AgentEvent) => void, signal?: AbortSignal): Promise<boolean> {
    const iterator = events[Symbol.asyncIterator]();
    while (true) {
      throwIfAborted(signal);
      const next = await nextEvent(iterator, signal);
      if (next.done) return false;
      const event = next.value;
      const shouldHalt = this.handleCodexEvent(event, emit);
      if (shouldHalt) return true;
    }
  }

  private preflightPrompt(prompt: string): void {
    if (prompt.includes("../") || prompt.toLowerCase().includes("outside sandbox")) {
      this.roomCode.ensureInsideSandbox("../escape.ts", "Prompt requested a filesystem path outside the active room.", "codex room edit");
    }
  }

  private handleCodexEvent(event: ThreadEvent, emit: (event: AgentEvent) => void): boolean {
    if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
      const item = event.item;
      if (item.type === "command_execution") {
        emit(log(`Codex command ${item.status}: ${item.command}`));
      }
      if (item.type === "file_change") {
        for (const change of item.changes) {
          this.roomCode.ensureInsideSandbox(change.path, "Codex proposed a file change outside the active room.", `codex file_change ${change.kind}`);
        }
        emit(log(`Codex file change ${item.status}: ${item.changes.map((change) => change.path).join(", ")}`));
      }
      if (event.type === "item.completed" && item.type === "agent_message") {
        emit(log(shortLog(item.text)));
      }
      if (event.type === "item.completed" && item.type === "error") {
        emit({ type: "error", message: item.message, at: new Date().toISOString() });
        return true;
      }
    }

    if (event.type === "turn.completed") {
      emit(usageCost(event.usage));
    }
    if (event.type === "turn.failed") {
      emit({ type: "error", message: event.error.message, at: new Date().toISOString() });
      return true;
    }
    if (event.type === "error") {
      emit({ type: "error", message: event.message, at: new Date().toISOString() });
      return true;
    }
    return false;
  }
}

function buildArchitectPrompt(input: ArchitectRunInput, currentScene: string): string {
  return [
    "Edit only ./roomScene.ts in the current working directory.",
    "Do not read, write, create, delete, or request access to files other than ./roomScene.ts.",
    "You have full creative control over the Three.js scene inside that one file.",
    "The host app owns the camera, controls, UI, renderer, and hot reload. Do not create a renderer, camera, controls, DOM nodes, network calls, timers, or imports beyond type-only local imports.",
    "Keep the module contract: export const roomTitle = string; export function buildRoom({ THREE, root, scene }: RoomSceneContext): void.",
    "Do not write THREE.* TypeScript type annotations such as : THREE.DataTexture; let values infer their types inside buildRoom.",
    "Avoid indexed array mutation patterns that can produce possibly-undefined TypeScript errors; destructure fixed object groups before setting properties.",
    "Make the narrowest scoped change that satisfies the user, but maximize visual quality within that scope. Targeted means do not disturb unrelated scene areas; it does not mean simple, sparse, flat, boxy, or placeholder-like.",
    "Judge every request by rendered browser appearance, not by whether the code names or claims the right thing. The user sees pixels, not source code.",
    "Default to the most immersive user-visible version of the requested change that remains performant: strong silhouettes, real-world proportions, layered construction, procedural texture detail, careful material roughness/metalness, and lighting-aware placement.",
    "Color, texture, atmosphere, scale, object quality, and layout requests are about rendered appearance. Account for existing lights, surface normals, tone mapping, shadows, camera position, contrast, and material maps so the user-visible result matches the request.",
    "If the user names one surface, object, color, material, or feature, preserve unrelated scene code, palette, layout, lighting, walls, floor, ceiling, fog, and camera-adjacent assumptions.",
    "For targeted requests, edit only the named scene areas. For example: floor/carpet requests only change floor/carpet material or texture; wall requests only change walls; ceiling surface/panel/material requests only change ceiling surfaces; lighting requests only change lights/fixtures. Do not change other scene areas unless explicitly requested.",
    "Ceiling height, room height, taller, lower, raised ceiling, double-height, and other volume changes are layout requests, not ceiling-surface requests. Coordinate the ceiling, walls, vertical positions, openings, and relevant lights so the rendered room remains continuous with no gaps.",
    "Scene code may use pure helper functions and constants in roomScene.ts for complex objects, procedural textures, reusable materials, and layout utilities.",
    "Instantiate Three.js objects from buildRoom or helper functions called by buildRoom, then add them to root and set scene.background/fog as needed.",
    "The world can expand beyond the starter 10x10 room. When adding a doorway, hall, exterior, or adjacent room, make it real navigable space with a walkable floor and visible continuation, not just a decorative door on a wall.",
    "Walls and solid meshes are treated as physical obstacles at camera height; leave actual gaps in wall geometry where the user should be able to walk through.",
    "For material and surface requests, implement real Three.js materials and procedural DataTexture work where useful, with visible texture scale, repeat, grain, weave, seams, imperfections, or relief cues. Do not use CanvasTexture, document.createElement, or any DOM canvas API.",
    "For ceilings and other undersides, remember that the visible face may receive little direct light. If the requested surface color must read clearly, use material color, emissive, emissiveIntensity, or carefully scoped local fill light so the rendered surface matches the request.",
    "For furniture and object requests, avoid blocky or cartoonish stacked-cube forms unless the user asks for that style. Use real-world scale, recognizable object anatomy, rounded or bevel-like visible edges, cylinders/spheres/lathe/extrude/shape geometry where appropriate, layered details, contact shadows, and subtle material/texture variation.",
    "Prefer a few well-proportioned, carefully modeled parts over many crude boxes. For chairs, tables, lamps, cabinets, and similar objects, include legs/supports, thickness, joins, cushions or trims, and small asymmetries that make the object feel designed.",
    "For animated requests such as flicker, movement, pulsing, blinking, shimmer, or drift, do not use timers or requestAnimationFrame. Instead set scene.userData.isAnimated = true or root.userData.isAnimated = true, then assign scene.userData.update or root.userData.update to a deterministic function that accepts { time, delta, scene, root } and updates the relevant materials/lights. The host will keep rendering while those animation hooks exist.",
    "Do not fake a floor material with a raised slab unless the user asks for a rug or object.",
    "Optimize for real-time browser use: avoid unbounded loops, huge geometries, external assets, and excessive lights.",
    "After editing, summarize the Three.js changes you made.",
    "",
    "Current roomScene.ts:",
    currentScene,
    "",
    "User request:",
    input.prompt,
  ].join("\n");
}

function buildRepairPrompt(input: ArchitectRunInput, invalidScene: string, validationErrors: string[]): string {
  return [
    "Repair ./roomScene.ts so it satisfies validation while still fulfilling the original user request.",
    "Edit only ./roomScene.ts. Do not access any other file.",
    "Do not remove the user's intended visual change; implement it another safe way if the current approach violates constraints.",
    "If validation says the edit changed unrelated scene areas, restore those unrelated areas and keep only the requested targeted change.",
    "Repairs should keep or improve the rendered appearance and visual ambition of the requested change; do not downgrade to a crude placeholder merely to pass validation.",
    "Keep the module contract: export const roomTitle = string; export function buildRoom({ THREE, root, scene }: RoomSceneContext): void.",
    "Use Three.js geometry, materials, lights, fog, procedural DataTexture, and pure local helper functions only. Do not use DOM APIs, CanvasTexture, renderer/camera creation, network calls, or timers.",
    "Helper functions must be deterministic and local to roomScene.ts; they may build and return Three.js objects, textures, materials, or groups that buildRoom attaches to root.",
    "If repairing furniture or object code, preserve the user's intended object while improving it with real-world proportions, rounded/curved geometry where useful, and material detail instead of simplifying it into blocky boxes.",
    "If the request involves expanding the room, doorway, hall, exterior, or adjacent room, make the extension real navigable space with actual gaps in wall geometry and a walkable floor.",
    "Do not write THREE.* TypeScript namespace annotations.",
    "",
    "Validation errors:",
    validationErrors.join("\n"),
    "",
    "Original user request:",
    input.prompt,
    "",
    "Current invalid roomScene.ts:",
    invalidScene,
  ].join("\n");
}

function turnOptions(signal: AbortSignal | undefined): TurnOptions {
  return signal ? { signal } : {};
}

function log(message: string): AgentEvent {
  return { type: "log", message, at: new Date().toISOString() };
}

class RunAbortedError extends Error {
  public constructor() {
    super("Room edit cancelled.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunAbortedError();
}

function nextEvent(iterator: AsyncIterator<ThreadEvent>, signal?: AbortSignal): Promise<IteratorResult<ThreadEvent>> {
  if (!signal) return iterator.next();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RunAbortedError());
    signal.addEventListener("abort", abort, { once: true });
    iterator.next().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function validateTargetedEditScope(prompt: string, before: string, after: string): string[] {
  const targetedDomains = inferTargetedDomains(prompt);
  if (targetedDomains.size === 0) return [];
  const allowedDomains = expandAllowedTargetDomains(targetedDomains);
  const changedDomains = protectedEditDomains.filter((domain) => !allowedDomains.has(domain.key) && domainLines(before, domain.pattern) !== domainLines(after, domain.pattern));
  if (changedDomains.length === 0) return [];
  const requestedAreas = [...targetedDomains].map((key) => protectedEditDomains.find((domain) => domain.key === key)?.label ?? key).join(", ");
  return [
    `The user asked for a targeted change to ${requestedAreas}, but the edit also changed ${changedDomains.map((domain) => domain.label).join(", ")}. Preserve unrelated scene areas and only update the requested target.`,
  ];
}

function expandAllowedTargetDomains(targetedDomains: Set<string>): Set<string> {
  const allowedDomains = new Set(targetedDomains);
  if (targetedDomains.has("layout")) {
    allowedDomains.add("floor");
    allowedDomains.add("walls");
    allowedDomains.add("ceiling");
  }
  return allowedDomains;
}

const protectedEditDomains = [
  { key: "floor", label: "floor/carpet", promptPattern: /\b(floor|carpet|rug|ground)\b/i, pattern: /\b(floor|carpet|rug|ground)\b/i },
  { key: "walls", label: "walls", promptPattern: /\b(wall|walls|wallpaper|paint)\b/i, pattern: /\b(wall|walls|wallpaper|wallMaterial|wallGeometry|addWall)\b/i },
  { key: "ceiling", label: "ceiling", promptPattern: /\b(ceiling|coffer|coffered|acoustic tile|ceiling tile)\b/i, pattern: /\b(ceiling|ceilingMaterial|ceilingTexture|ceilingGrid)\b/i },
  { key: "background", label: "background/fog", promptPattern: /\b(background|fog|sky|atmosphere)\b/i, pattern: /scene\.background|scene\.fog|new THREE\.Fog/i },
  { key: "lighting", label: "lighting", promptPattern: /\b(light|lights|lighting|lamp|fixture|glow|shadow)\b/i, pattern: /\b(?:ambient|directional|point|spot|hemisphere)?light\b|THREE\.\w*Light|fixture/i },
  { key: "layout", label: "layout dimensions/openings", promptPattern: /\b(layout|room size|dimension|dimensions|height|double-height|double height|taller|lower|raise|raised|expand|extend|door|doorway|opening|corridor|hall|adjacent room|wall opening)\b/i, pattern: /\b(roomHalf|roomWidth|roomDepth|roomHeight|wallHeight|ceilingHeight|corridor|door|doorway|opening|hall|adjacent|extension|wallConfigs|wallPositions)\b/i },
  { key: "furniture", label: "furniture/objects", promptPattern: /\b(sofa|table|chair|desk|bed|shelf|cabinet|object|statue|plant|column)\b/i, pattern: /\b(sofa|table|chair|desk|bed|shelf|cabinet|object|statue|plant|column)\b/i },
];

function domainLines(source: string, pattern: RegExp): string {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
    .join("\n");
}

function inferTargetedDomains(prompt: string): Set<string> {
  const domains = new Set<string>();
  for (const domain of protectedEditDomains) {
    if (domain.promptPattern.test(prompt)) domains.add(domain.key);
  }
  return domains;
}

function usageCost(usage: Usage): AgentEvent {
  return {
    type: "cost",
    model: "codex",
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    usd: 0,
    totalUsd: 0,
    at: new Date().toISOString(),
  };
}

function shortLog(message: string): string {
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function isLikelySandboxError(error: unknown): boolean {
  const message = sandboxErrorMessage(error).toLowerCase();
  return message.includes("sandbox") || message.includes("approval") || message.includes("permission");
}

function sandboxErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
