import { Codex, type ThreadEvent, type ThreadOptions, type Usage } from "@openai/codex-sdk";
import type { AgentEvent } from "../../shared/api";
import type { ArchitectRunInput, ArchitectRunner } from "./architectRunner";
import { RoomCodeRepository, SandboxViolationError } from "./roomCodeRepository";
import { evaluateSandboxPath } from "./sandboxPolicy";

interface CodexThread {
  runStreamed(input: string): Promise<{ events: AsyncIterable<ThreadEvent> }>;
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
      this.preflightPrompt(input.prompt);
      const currentScene = await this.roomCode.readRawScene();
      const lastGoodScene = await this.roomCode.readRawActiveScene();

      const thread = this.codex.startThread({
        model: input.model,
        workingDirectory: this.roomCode.sandboxRoot,
        skipGitRepoCheck: true,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      });
      const initialTurn = await thread.runStreamed(buildArchitectPrompt(input, currentScene));
      if (await this.streamTurn(initialTurn.events, emit)) return;

      const sceneSource = await this.validateOrRepairScene(thread, input, emit, lastGoodScene);
      if (!sceneSource) return;
      await this.roomCode.writeActiveSceneSource(sceneSource);
      emit({ type: "scene-updated", at: new Date().toISOString() });
      emit({ type: "complete", runId: input.runId, at: new Date().toISOString() });
    } catch (error) {
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
    lastGoodScene: string,
  ): Promise<string | null> {
    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      const sceneSource = await this.roomCode.readRawScene();
      const validationErrors = this.roomCode.validateSceneSource(sceneSource);
      if (validationErrors.length === 0) {
        return sceneSource;
      }
      if (attempt >= this.maxRepairAttempts) {
        await this.roomCode.writeSceneSource(lastGoodScene);
        emit({ type: "error", message: `Generated scene did not pass validation after repair:\n${validationErrors.join("\n")}`, at: new Date().toISOString() });
        return null;
      }

      emit(log(`Generated scene failed validation. Asking Codex to repair it without changing the user intent.\n${validationErrors.join("\n")}`));
      const repairTurn = await thread.runStreamed(buildRepairPrompt(input, sceneSource, validationErrors));
      if (await this.streamTurn(repairTurn.events, emit)) {
        return null;
      }
    }
    return null;
  }

  private async streamTurn(events: AsyncIterable<ThreadEvent>, emit: (event: AgentEvent) => void): Promise<boolean> {
    for await (const event of events) {
      const shouldHalt = this.handleCodexEvent(event, emit);
      if (shouldHalt) return true;
    }
    return false;
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
    "Build all geometry, materials, textures, fog, and lights inside buildRoom by adding objects to root and setting scene.background/fog as needed.",
    "For material requests, implement real Three.js materials and procedural DataTexture work where useful. Do not use CanvasTexture, document.createElement, or any DOM canvas API.",
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
    "Keep the module contract: export const roomTitle = string; export function buildRoom({ THREE, root, scene }: RoomSceneContext): void.",
    "Use Three.js geometry, materials, lights, fog, and procedural DataTexture only. Do not use DOM APIs, CanvasTexture, renderer/camera creation, network calls, or timers.",
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

function log(message: string): AgentEvent {
  return { type: "log", message, at: new Date().toISOString() };
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
