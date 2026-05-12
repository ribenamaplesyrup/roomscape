import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { CodexSdkArchitectRunner } from "../src/server/agent/codexArchitectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import type { AgentEvent } from "../src/shared/api";
import { emptyRoomConfig } from "../src/shared/room";

class FakeCodexThread {
  public prompts: string[] = [];
  private readonly turns: FakeTurn[];

  public constructor(
    turns: FakeTurn[],
  ) {
    this.turns = [...turns];
  }

  public get prompt(): string {
    return this.prompts[0] ?? "";
  }

  /** Captures the prompt and returns deterministic Codex-style stream events. */
  public async runStreamed(input: string): Promise<{ events: AsyncIterable<ThreadEvent> }> {
    this.prompts.push(input);
    const turn = this.turns.shift();
    if (!turn) throw new Error("Unexpected Codex turn.");
    await turn.beforeStream?.();
    return { events: asyncEvents(turn.events) };
  }
}

interface FakeTurn {
  events: ThreadEvent[];
  beforeStream?: () => Promise<void>;
}

class FakeCodex {
  public options: ThreadOptions | null = null;
  public thread: FakeCodexThread;

  public constructor(eventsOrTurns: ThreadEvent[] | FakeTurn[], beforeStream?: () => Promise<void>) {
    const turns = isFakeTurns(eventsOrTurns)
      ? eventsOrTurns
      : [beforeStream ? { events: eventsOrTurns, beforeStream } : { events: eventsOrTurns }];
    this.thread = new FakeCodexThread(turns);
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
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeRoomScene(root, "green table scene"));
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
    expect(codex.thread.prompt).toContain("Edit only ./roomScene.ts");
    expect(codex.thread.prompt).toContain("full creative control over the Three.js scene");
    expect(codex.thread.prompt).toContain("Keep the module contract");
    expect(codex.thread.prompt).toContain("Do not write THREE.* TypeScript type annotations");
    expect(codex.thread.prompt).toContain("procedural DataTexture");
    expect(codex.thread.prompt).toContain("Do not use CanvasTexture");
    expect(codex.thread.prompt).not.toContain("Gulf Futurist");
    expect(codex.thread.prompt).not.toContain("Atmosphere and texture are primary");
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("green table scene");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("does not promote invalid generated scene code", async () => {
    const root = await mkRoomRoot();
    await writeFile(path.join(root, "activeRoomScene.ts"), "export const roomTitle = 'Still valid';\n", "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(path.join(root, "roomScene.ts"), "export const roomTitle = 'Broken';\n", "utf8"));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Break the scene", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(events.at(-1)?.type).toBe("error");
    expect(events.some((event) => event.type === "scene-updated")).toBe(false);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Still valid");
  });

  it("asks Codex to repair invalid scene code before promoting", async () => {
    const root = await mkRoomRoot();
    await writeFile(path.join(root, "activeRoomScene.ts"), "export const roomTitle = 'Still valid';\n", "utf8");
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), "export const roomTitle = 'Broken';\n", "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeRoomScene(root, "Repaired green table scene"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add a green table", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(2);
    expect(codex.thread.prompts[1]).toContain("Repair ./roomScene.ts");
    expect(codex.thread.prompts[1]).toContain("Do not remove the user's intended visual change");
    expect(events.some((event) => event.type === "log" && event.message.includes("failed validation"))).toBe(true);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Repaired green table scene");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("does not promote scene code with unstable Three.js namespace type annotations", async () => {
    const root = await mkRoomRoot();
    await writeFile(path.join(root, "activeRoomScene.ts"), "export const roomTitle = 'Still valid';\n", "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(
      path.join(root, "roomScene.ts"),
      [
        'import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";',
        "",
        "export const roomTitle = 'Broken type';",
        "",
        "export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {",
        "  const makeTexture = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(3), 1, 1, THREE.RGBFormat);",
        "  scene.background = new THREE.Color('#ffffff');",
        "  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: makeTexture() })));",
        "}",
        "",
      ].join("\n"),
      "utf8",
    ));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add a texture", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(events.some((event) => event.type === "scene-updated")).toBe(false);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Still valid");
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

function isFakeTurns(value: ThreadEvent[] | FakeTurn[]): value is FakeTurn[] {
  return value.length > 0 && "events" in value[0]!;
}

async function mkRoomRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "roomscape-codex-"));
  await writeRoomScene(root, "Bare Room");
  await writeActiveRoomScene(root, "Bare Room");
  return root;
}

function runInput(overrides: Partial<Parameters<CodexSdkArchitectRunner["run"]>[0]> = {}) {
  return {
    runId: "run-1",
    prompt: "Add a table",
    model: "gpt-5.4-mini",
    currentConfig: emptyRoomConfig,
    ...overrides,
  };
}

async function writeRoomScene(root: string, title: string): Promise<void> {
  await writeFile(
    path.join(root, "roomScene.ts"),
    roomSceneSource(title),
    "utf8",
  );
}

async function writeActiveRoomScene(root: string, title: string): Promise<void> {
  await writeFile(
    path.join(root, "activeRoomScene.ts"),
    roomSceneSource(title),
    "utf8",
  );
}

function roomSceneSource(title: string): string {
  return [
    'import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";',
    "",
    `export const roomTitle = ${JSON.stringify(title)};`,
    "",
    "export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {",
    "  scene.background = new THREE.Color('#ffffff');",
    "  root.add(new THREE.HemisphereLight('#ffffff', '#555555', 1));",
    "}",
    "",
  ].join("\n");
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
