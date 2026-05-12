import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { CodexSdkArchitectRunner } from "../src/server/agent/codexArchitectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import type { AgentEvent } from "../src/shared/api";
import { emptyRoomConfig, type RoomConfig } from "../src/shared/room";

class FakeCodexThread {
  public prompt = "";

  public constructor(
    private readonly events: ThreadEvent[],
    private readonly beforeStream?: () => Promise<void>,
  ) {}

  /** Captures the prompt and returns deterministic Codex-style stream events. */
  public async runStreamed(input: string): Promise<{ events: AsyncIterable<ThreadEvent> }> {
    this.prompt = input;
    await this.beforeStream?.();
    return { events: asyncEvents(this.events) };
  }
}

class FakeCodex {
  public options: ThreadOptions | null = null;
  public thread: FakeCodexThread;

  public constructor(events: ThreadEvent[], beforeStream?: () => Promise<void>) {
    this.thread = new FakeCodexThread(events, beforeStream);
  }

  /** Records the SDK thread options so tests can assert sandbox scope. */
  public startThread(options: ThreadOptions): FakeCodexThread {
    this.options = options;
    return this.thread;
  }
}

describe("Codex SDK architect runner", () => {
  it("starts Codex with only the active room as its writable workspace", async () => {
    const root = await mkRoomRoot();
    const nextConfig = roomWithObject("green table");
    const codex = new FakeCodex([fileChange("roomConfig.ts"), completed()], () => writeRoomConfig(root, nextConfig));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add a green table", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.options).toMatchObject({
      workingDirectory: root,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    expect(codex.options?.additionalDirectories).toBeUndefined();
    expect(codex.thread.prompt).toContain("Edit only ./roomConfig.ts");
    expect(events.some((event) => event.type === "room-updated" && event.config.objects[0]?.label === "green table")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("halts with a permission request when Codex proposes a file outside the active room", async () => {
    const root = await mkRoomRoot();
    const codex = new FakeCodex([fileChange("../escape.ts"), completed()]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add a fixture", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(events.at(-1)?.type).toBe("permission-request");
    expect(events.some((event) => event.type === "complete")).toBe(false);
  });

  it("preflights explicit outside-sandbox prompts before starting Codex", async () => {
    const root = await mkRoomRoot();
    const codex = new FakeCodex([]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Write outside sandbox at ../secrets", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.options).toBeNull();
    expect(events.at(-1)?.type).toBe("permission-request");
  });
});

async function mkRoomRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "roomscape-codex-"));
}

function runInput(overrides: Partial<Parameters<CodexSdkArchitectRunner["run"]>[0]> = {}) {
  return {
    runId: "run-1",
    prompt: "Add a table",
    model: "gpt-5.4-mini",
    persona: "Gulf Futurist: luminous restraint",
    currentConfig: emptyRoomConfig,
    ...overrides,
  };
}

function roomWithObject(label: string): RoomConfig {
  return {
    ...emptyRoomConfig,
    name: "Co-created room",
    objects: [{
      id: "object-1",
      kind: "table",
      label,
      color: "#47b86b",
      position: [0, 0.55, -1.5],
      scale: [1.2, 0.45, 0.8],
    }],
    updatedAt: new Date().toISOString(),
  };
}

async function writeRoomConfig(root: string, config: RoomConfig): Promise<void> {
  await writeFile(
    path.join(root, "roomConfig.ts"),
    [
      'import type { RoomConfig } from "../../../src/shared/room";',
      "",
      `export const roomConfig = ${JSON.stringify(config, null, 2)} satisfies RoomConfig;`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function fileChange(filePath: string): ThreadEvent {
  return {
    type: "item.completed",
    item: {
      id: "item-1",
      type: "file_change",
      changes: [{ path: filePath, kind: "update" }],
      status: "completed",
    },
  };
}

function completed(): ThreadEvent {
  return {
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 4,
      reasoning_output_tokens: 0,
    },
  };
}

async function* asyncEvents(events: ThreadEvent[]): AsyncIterable<ThreadEvent> {
  for (const event of events) {
    yield event;
  }
}
