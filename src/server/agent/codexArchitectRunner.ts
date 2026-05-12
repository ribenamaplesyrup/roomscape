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
}

/** Runs the Architect through the Codex SDK while keeping writes scoped to the active room sandbox. */
export class CodexSdkArchitectRunner implements ArchitectRunner {
  private readonly codex: CodexThreadFactory;

  public constructor(
    private readonly roomCode: RoomCodeRepository,
    options: CodexSdkArchitectRunnerOptions = {},
  ) {
    this.codex = options.codex ?? new Codex();
  }

  /** Streams Codex work logs, validates sandbox file changes, and reloads the generated room config. */
  public async run(input: ArchitectRunInput, emit: (event: AgentEvent) => void): Promise<void> {
    try {
      emit(log(`Architect persona loaded: ${input.persona}`));
      emit(log(`Starting Codex Architect with ${input.model}.`));
      this.preflightPrompt(input.prompt);
      await this.roomCode.writeConfig(input.currentConfig);

      const thread = this.codex.startThread({
        model: input.model,
        workingDirectory: this.roomCode.sandboxRoot,
        skipGitRepoCheck: true,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      });
      const turn = await thread.runStreamed(buildArchitectPrompt(input));

      for await (const event of turn.events) {
        const shouldHalt = this.handleCodexEvent(event, emit);
        if (shouldHalt) return;
      }

      const config = await this.roomCode.readConfig();
      emit({ type: "room-updated", config, at: new Date().toISOString() });
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

function buildArchitectPrompt(input: ArchitectRunInput): string {
  return [
    "You are the Roomscape Architect.",
    `Persona: ${input.persona}`,
    "",
    "Edit only ./roomConfig.ts in the current working directory.",
    "Do not read, write, create, delete, or request access to files outside the current working directory.",
    "Keep the file as TypeScript that imports RoomConfig and exports a JSON-compatible literal named roomConfig using `satisfies RoomConfig`.",
    "Use only these object kinds: cube, table, sofa, column, light.",
    "Every object must include all required fields: id, kind, label, color, position, and scale. Light objects may also include an optional numeric intensity.",
    "Use stable unique string ids such as carpet-field, carpet-tile-1, table-1, light-1.",
    "After editing, provide a concise summary of what changed.",
    "",
    "Current room config:",
    JSON.stringify(input.currentConfig, null, 2),
    "",
    "User request:",
    input.prompt,
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
