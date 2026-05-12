import { EventEmitter } from "node:events";
import type { AgentEvent } from "../../shared/api";
import type { RoomConfig, RoomObject, RoomObjectKind } from "../../shared/room";
import { RoomCodeRepository, SandboxViolationError } from "./roomCodeRepository";

export interface ArchitectRunInput {
  runId: string;
  prompt: string;
  model: string;
  persona: string;
  currentConfig: RoomConfig;
}

export interface ArchitectRunner {
  run(input: ArchitectRunInput, emit: (event: AgentEvent) => void): Promise<void>;
}

const costPerThousand: Record<string, number> = {
  "gpt-5.5": 0.02,
  "gpt-5.4": 0.012,
  "gpt-5.4-mini": 0.003,
};

export class DeterministicArchitectRunner implements ArchitectRunner {
  public constructor(private readonly roomCode: RoomCodeRepository) {}

  /** Simulates the SDK-facing agent loop while preserving the real sandbox and telemetry contracts. */
  public async run(input: ArchitectRunInput, emit: (event: AgentEvent) => void): Promise<void> {
    try {
      emit(log(`Architect persona loaded: ${input.persona}`));
      emit(log(`Planning room mutation with ${input.model}.`));

      if (input.prompt.includes("../") || input.prompt.toLowerCase().includes("outside sandbox")) {
        this.roomCode.ensureInsideSandbox("../escape.ts", "Prompt requested a filesystem path outside the active room.", "apply_patch ../escape.ts");
      }

      const nextConfig = mutateRoom(input.currentConfig, input.prompt);
      emit(log("Writing generated Three.js room config inside active sandbox."));
      await this.roomCode.writeConfig(nextConfig);
      emit(cost(input.model, input.prompt.length, JSON.stringify(nextConfig).length));
      emit({ type: "room-updated", config: nextConfig, at: new Date().toISOString() });
      emit({ type: "complete", runId: input.runId, at: new Date().toISOString() });
    } catch (error) {
      if (error instanceof SandboxViolationError) {
        emit({ type: "permission-request", request: error.request, at: new Date().toISOString() });
        return;
      }
      emit({ type: "error", message: error instanceof Error ? error.message : "Unknown agent error.", at: new Date().toISOString() });
    }
  }
}

export class AgentRunBus {
  private readonly bus = new EventEmitter();
  private readonly history = new Map<string, AgentEvent[]>();

  /** Stores and broadcasts a run event so late SSE subscribers receive prior messages. */
  public publish(runId: string, event: AgentEvent): void {
    const events = this.history.get(runId) ?? [];
    events.push(event);
    this.history.set(runId, events);
    this.bus.emit(runId, event);
  }

  /** Subscribes to future events and replays the current run history immediately. */
  public subscribe(runId: string, listener: (event: AgentEvent) => void): () => void {
    for (const event of this.history.get(runId) ?? []) {
      listener(event);
    }
    this.bus.on(runId, listener);
    return () => this.bus.off(runId, listener);
  }
}

function mutateRoom(config: RoomConfig, prompt: string): RoomConfig {
  const lower = prompt.toLowerCase();
  const kind: RoomObjectKind = lower.includes("sofa")
    ? "sofa"
    : lower.includes("table")
      ? "table"
      : lower.includes("column")
        ? "column"
        : lower.includes("light")
          ? "light"
          : "cube";
  const color = lower.includes("pink")
    ? "#f3a6c8"
    : lower.includes("green")
      ? "#47b86b"
      : lower.includes("blue")
        ? "#4b7bd8"
        : lower.includes("gold")
          ? "#d2a84d"
          : config.palette.accent;
  const index = config.objects.length;
  const object: RoomObject = {
    id: `object-${Date.now()}-${index}`,
    kind,
    label: prompt.slice(0, 48) || kind,
    color,
    position: [((index % 5) - 2) * 1.6, kind === "light" ? 2.2 : 0.55, -1.5 - Math.floor(index / 5) * 1.3],
    scale: kind === "sofa" ? [1.8, 0.7, 0.8] : kind === "table" ? [1.2, 0.45, 0.8] : kind === "column" ? [0.45, 2.4, 0.45] : [0.8, 0.8, 0.8],
  };
  return {
    ...config,
    name: config.name === "Bare Room" ? "Co-created room" : config.name,
    objects: [...config.objects, object],
    updatedAt: new Date().toISOString(),
  };
}

function log(message: string): AgentEvent {
  return { type: "log", message, at: new Date().toISOString() };
}

function cost(model: string, inputChars: number, outputChars: number): AgentEvent {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const usd = ((inputTokens + outputTokens) / 1000) * (costPerThousand[model] ?? costPerThousand["gpt-5.4-mini"]!);
  return {
    type: "cost",
    model,
    inputTokens,
    outputTokens,
    usd,
    totalUsd: usd,
    at: new Date().toISOString(),
  };
}
