import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { CodexSdkArchitectRunner } from "../src/server/agent/codexArchitectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import type { AgentEvent } from "../src/shared/api";
import { emptyRoomConfig } from "../src/shared/room";

class FakeCodexThread {
  public prompts: string[] = [];
  public turnOptions: TurnOptions[] = [];
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
  public async runStreamed(input: string, turnOptions: TurnOptions = {}): Promise<{ events: AsyncIterable<ThreadEvent> }> {
    this.prompts.push(input);
    this.turnOptions.push(turnOptions);
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
    expect(codex.thread.prompt).toContain("pure helper functions");
    expect(codex.thread.prompt).toContain("helper functions called by buildRoom");
    expect(codex.thread.prompt).toContain("maximize visual quality");
    expect(codex.thread.prompt).toContain("does not mean simple, sparse, flat, boxy");
    expect(codex.thread.prompt).toContain("Judge every request by rendered browser appearance");
    expect(codex.thread.prompt).toContain("The user sees pixels, not source code");
    expect(codex.thread.prompt).toContain("Color, texture, atmosphere, scale, object quality, and layout requests");
    expect(codex.thread.prompt).toContain("procedural texture detail");
    expect(codex.thread.prompt).toContain("rendered appearance");
    expect(codex.thread.prompt).toContain("surface normals");
    expect(codex.thread.prompt).toContain("ceilings and other undersides");
    expect(codex.thread.prompt).toContain("avoid blocky or cartoonish");
    expect(codex.thread.prompt).toContain("recognizable object anatomy");
    expect(codex.thread.prompt).toContain("For animated requests");
    expect(codex.thread.prompt).toContain("scene.userData.update or root.userData.update");
    expect(codex.thread.prompt).toContain("The host will keep rendering while those animation hooks exist");
    expect(codex.thread.prompt).toContain("The world can expand beyond the starter 10x10 room");
    expect(codex.thread.prompt).toContain("leave actual gaps in wall geometry");
    expect(codex.thread.prompt).toContain("For targeted requests");
    expect(codex.thread.prompt).toContain("Ceiling height, room height");
    expect(codex.thread.prompt).toContain("rendered room remains continuous with no gaps");
    expect(codex.thread.prompt).not.toContain("Gulf Futurist");
    expect(codex.thread.prompt).not.toContain("Atmosphere and texture are primary");
    expect(codex.thread.turnOptions[0]?.signal).toBeUndefined();
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("green table scene");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("does not promote invalid generated scene code", async () => {
    const root = await mkRoomRoot();
    await writeFile(path.join(root, "activeRoomScene.ts"), "export const roomTitle = 'Still valid';\n", "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(path.join(root, "roomScene.ts"), "export const roomTitle = 'Broken';\n", "utf8"));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex, maxRepairAttempts: 0 });
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
    expect(codex.thread.turnOptions).toHaveLength(2);
    expect(codex.thread.prompts[1]).toContain("Repair ./roomScene.ts");
    expect(codex.thread.prompts[1]).toContain("Do not remove the user's intended visual change");
    expect(events.some((event) => event.type === "log" && event.message.includes("failed validation"))).toBe(true);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Repaired green table scene");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("retries failed repairs with the validation error before giving up", async () => {
    const root = await mkRoomRoot();
    await writeFile(path.join(root, "activeRoomScene.ts"), "export const roomTitle = 'Still valid';\n", "utf8");
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), "export const roomTitle = 'Broken';\n", "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), "export const roomTitle = 'Still broken';\n", "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeRoomScene(root, "Second repair green table scene"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add a green table", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(3);
    expect(codex.thread.prompts[1]).toContain("repair attempt 1 of 2");
    expect(codex.thread.prompts[2]).toContain("repair attempt 2 of 2");
    expect(events.some((event) => event.type === "log" && event.message.includes("repair 1/2"))).toBe(true);
    expect(events.some((event) => event.type === "log" && event.message.includes("repair 2/2"))).toBe(true);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Second repair green table scene");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("repairs carpet-only edits that retheme unrelated scene areas", async () => {
    const root = await mkRoomRoot();
    const originalCarpetScene = carpetSceneSource({
      title: "Original carpet room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalCarpetScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalCarpetScene, "utf8");
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), carpetSceneSource({
          title: "Bright Sunroom",
          background: "#fff4c5",
          floor: "#fff06a",
          wall: "#ffe7aa",
          ceiling: "#fffbe8",
        }), "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), carpetSceneSource({
          title: "Original carpet room",
          background: "#ffffff",
          floor: "#fff06a",
          wall: "#d7d2c8",
          ceiling: "#f1eee8",
        }), "utf8"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Make the carpet light yellow", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(2);
    expect(codex.thread.prompts[1]).toContain("targeted change to floor/carpet");
    expect(events.some((event) => event.type === "log" && event.message.includes("targeted change to floor/carpet"))).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain('color: "#fff06a"');
    expect(promoted).toContain('color: "#d7d2c8"');
    expect(promoted).not.toContain("#ffe7aa");
  });

  it("repairs wall-only edits that change unrelated lighting", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
          title: "Blue wall room",
          background: "#ffffff",
          floor: "#8a8479",
          wall: "#5d8fd8",
          ceiling: "#f1eee8",
          light: "#ffe2a0",
        }), "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
          title: "Blue wall room",
          background: "#ffffff",
          floor: "#8a8479",
          wall: "#5d8fd8",
          ceiling: "#f1eee8",
          light: "#ffffff",
        }), "utf8"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Make the walls blue", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(2);
    expect(codex.thread.prompts[1]).toContain("targeted change to walls");
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain('color: "#5d8fd8"');
    expect(promoted).toContain('new THREE.HemisphereLight("#ffffff"');
    expect(promoted).not.toContain("#ffe2a0");
  });

  it("allows targeted ceiling edits to add ceiling geometry without treating it as layout drift", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(
      path.join(root, "roomScene.ts"),
      ceilingPanelSceneSource({
        title: "Original room",
        background: "#ffffff",
        floor: "#8a8479",
        wall: "#d7d2c8",
        ceiling: "#e7e2da",
        light: "#ffffff",
      }),
      "utf8",
    ));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add an office-style ceiling panel treatment", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(1);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain("ceilingPanelGeometry");
    expect(promoted).toContain('color: "#8a8479"');
    expect(promoted).toContain('color: "#d7d2c8"');
  });

  it("allows prompts that explicitly target multiple scene areas in one edit", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#fff06a",
      wall: "#5d8fd8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    }), "utf8"));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Make the carpet yellow and the walls blue", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(1);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain('color: "#fff06a"');
    expect(promoted).toContain('color: "#5d8fd8"');
    expect(promoted).toContain('color: "#f1eee8"');
  });

  it("breaks broad room requests into promoted incremental phases", async () => {
    const root = await mkRoomRoot();
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeRoomScene(root, "Church blockout"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeRoomScene(root, "Church details"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeRoomScene(root, "Church polish"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];
    const prompt = [
      "Transform the active room into an ambitious, walkable Gothic church interior.",
      "Include a long nave with side aisles, tall stone columns, ribbed vaulted ceiling, pointed arches, an altar and apse,",
      "rows of pews, procedural stained-glass windows, candles, warm lighting, foggy atmosphere, and real walkable gaps.",
    ].join(" ");

    await runner.run(runInput({ prompt, currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(3);
    expect(codex.thread.prompts[0]).toContain("Phase 1: create a fast");
    expect(codex.thread.prompts[1]).toContain("Phase 2: continue from the current validated blockout");
    expect(codex.thread.prompts[2]).toContain("Phase 3: polish");
    expect(events.filter((event) => event.type === "scene-updated")).toHaveLength(3);
    expect(events.some((event) => event.type === "log" && event.message.includes("Split broad room edit into 3 incremental phases"))).toBe(true);
    expect(events.some((event) => event.type === "log" && event.message.includes("Phase 1/3 promoted"))).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Church polish");
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("does not apply narrow targeted validation to broad scene replacements", async () => {
    const root = await mkRoomRoot();
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
          title: "Gothic Church Blockout",
          background: "#151a1d",
          floor: "#5e5b55",
          wall: "#7c7a70",
          ceiling: "#4a4742",
          light: "#ffd9a0",
        }), "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
          title: "Gothic Church Details",
          background: "#151a1d",
          floor: "#5e5b55",
          wall: "#7c7a70",
          ceiling: "#4a4742",
          light: "#ffd9a0",
        }), "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), targetedSceneSource({
          title: "Gothic Church Polish",
          background: "#151a1d",
          floor: "#5e5b55",
          wall: "#7c7a70",
          ceiling: "#4a4742",
          light: "#ffd9a0",
        }), "utf8"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];
    const prompt = "Transform the room into a walkable church interior with nave layout, side aisles, stone walls, vaulted ceiling, pew objects, stained glass materials, candles, warm lighting, and foggy atmosphere.";

    await runner.run(runInput({ prompt, currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(3);
    expect(events.some((event) => event.type === "log" && event.message.includes("targeted change"))).toBe(false);
    expect(events.filter((event) => event.type === "scene-updated")).toHaveLength(3);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Gothic Church Polish");
  });

  it("allows furniture edits to add object geometry without treating it as layout drift", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(
      path.join(root, "roomScene.ts"),
      chairSceneSource({
        title: "Original room",
        background: "#ffffff",
        floor: "#8a8479",
        wall: "#d7d2c8",
        ceiling: "#f1eee8",
        light: "#ffffff",
      }),
      "utf8",
    ));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Add an antique wooden chair", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(1);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain("chairSeat");
    expect(promoted).toContain('color: "#8a8479"');
    expect(promoted).toContain('color: "#d7d2c8"');
  });

  it("allows doorway and corridor edits to change structural surfaces needed for navigation", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(
      path.join(root, "roomScene.ts"),
      doorwaySceneSource({
        title: "Original room",
        background: "#ffffff",
        floor: "#8a8479",
        wall: "#d7d2c8",
        ceiling: "#f1eee8",
        light: "#ffffff",
      }),
      "utf8",
    ));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Create a doorway with a short corridor beyond it", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(1);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain("corridorFloor");
    expect(promoted).toContain("doorway");
    expect(promoted).toContain('new THREE.HemisphereLight("#ffffff"');
  });

  it("allows ceiling height changes to update continuous wall geometry", async () => {
    const root = await mkRoomRoot();
    const originalScene = targetedSceneSource({
      title: "Original room",
      background: "#ffffff",
      floor: "#8a8479",
      wall: "#d7d2c8",
      ceiling: "#f1eee8",
      light: "#ffffff",
    });
    await writeFile(path.join(root, "roomScene.ts"), originalScene, "utf8");
    await writeFile(path.join(root, "activeRoomScene.ts"), originalScene, "utf8");
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeFile(
      path.join(root, "roomScene.ts"),
      highCeilingSceneSource({
        title: "Original room",
        background: "#ffffff",
        floor: "#8a8479",
        wall: "#d7d2c8",
        ceiling: "#f1eee8",
        light: "#ffffff",
      }),
      "utf8",
    ));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Double the ceiling height", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(1);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    const promoted = await readFile(path.join(root, "activeRoomScene.ts"), "utf8");
    expect(promoted).toContain("ceiling.position.y = 6");
    expect(promoted).toContain("new THREE.PlaneGeometry(10, 6)");
    expect(promoted).toContain("[0, 3, -5, 0]");
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

    expect(events.some((event) => event.type === "log" && event.message.includes("Cleaned unsafe"))).toBe(true);
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("Broken type");
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.not.toContain(": THREE.DataTexture");
  });

  it("repairs scene code with undeclared shorthand material properties before promoting", async () => {
    const root = await mkRoomRoot();
    await writeActiveRoomScene(root, "Still valid");
    const codex = new FakeCodex([
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), [
          'import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";',
          "",
          'export const roomTitle = "Bad shorthand";',
          "",
          "export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {",
          "  scene.background = new THREE.Color('#ffffff');",
          "  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', side })));",
          "}",
          "",
        ].join("\n"), "utf8"),
      },
      {
        events: [fileChange("roomScene.ts"), completed()],
        beforeStream: () => writeFile(path.join(root, "roomScene.ts"), [
          'import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";',
          "",
          'export const roomTitle = "Repaired shorthand";',
          "",
          "export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {",
          "  scene.background = new THREE.Color('#ffffff');",
          "  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide })));",
          "}",
          "",
        ].join("\n"), "utf8"),
      },
    ]);
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });
    const events: AgentEvent[] = [];

    await runner.run(runInput({ prompt: "Make the panel double-sided", currentConfig: emptyRoomConfig }), (event) => events.push(event));

    expect(codex.thread.prompts).toHaveLength(2);
    expect(codex.thread.prompts[1]).toContain("shorthand property 'side'");
    expect(events.some((event) => event.type === "scene-updated")).toBe(true);
    await expect(readFile(path.join(root, "activeRoomScene.ts"), "utf8")).resolves.toContain("side: THREE.DoubleSide");
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

  it("passes abort signals through to Codex streamed turns", async () => {
    const root = await mkRoomRoot();
    const signal = new AbortController().signal;
    const codex = new FakeCodex([fileChange("roomScene.ts"), completed()], () => writeRoomScene(root, "green table scene"));
    const runner = new CodexSdkArchitectRunner(new RoomCodeRepository(root), { codex });

    await runner.run(runInput({ prompt: "Add a green table", currentConfig: emptyRoomConfig, signal }), () => undefined);

    expect(codex.thread.turnOptions[0]?.signal).toBe(signal);
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

function carpetSceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string }): string {
  return targetedSceneSource({ ...options, light: "#ffffff" });
}

function targetedSceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string; light: string }): string {
  return [
    'import type { RoomSceneContext } from "../../../src/client/room/sceneTypes";',
    "",
    `export const roomTitle = ${JSON.stringify(options.title)};`,
    "",
    "export function buildRoom({ THREE, root, scene }: RoomSceneContext): void {",
    `  scene.background = new THREE.Color("${options.background}");`,
    "  const floor = new THREE.Mesh(",
    "    new THREE.PlaneGeometry(10, 10),",
    `    new THREE.MeshStandardMaterial({ color: "${options.floor}", roughness: 1 }),`,
    "  );",
    "  floor.rotation.x = -Math.PI / 2;",
    "  root.add(floor);",
    "  const ceiling = new THREE.Mesh(",
    "    new THREE.PlaneGeometry(10, 10),",
    `    new THREE.MeshStandardMaterial({ color: "${options.ceiling}", roughness: 1 }),`,
    "  );",
    "  ceiling.position.y = 3;",
    "  ceiling.rotation.x = Math.PI / 2;",
    "  root.add(ceiling);",
    `  const wallMaterial = new THREE.MeshStandardMaterial({ color: "${options.wall}", roughness: 1 });`,
    "  const wallGeometry = new THREE.PlaneGeometry(10, 3);",
    "  const walls: Array<[number, number, number, number]> = [",
    "    [0, 1.5, -5, 0],",
    "    [0, 1.5, 5, Math.PI],",
    "    [-5, 1.5, 0, Math.PI / 2],",
    "    [5, 1.5, 0, -Math.PI / 2],",
    "  ];",
    "  for (const [x, y, z, rotationY] of walls) {",
    "    const wall = new THREE.Mesh(wallGeometry, wallMaterial);",
    "    wall.position.set(x, y, z);",
    "    wall.rotation.y = rotationY;",
    "    root.add(wall);",
    "  }",
    `  const ambient = new THREE.HemisphereLight("${options.light}", "#555555", 1.2);`,
    "  root.add(ambient);",
    "}",
    "",
  ].join("\n");
}

function ceilingPanelSceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string; light: string }): string {
  const baseScene = targetedSceneSource(options);
  return baseScene.replace(
    "  root.add(ceiling);",
    [
      "  root.add(ceiling);",
      "  const ceilingPanelMaterial = new THREE.MeshStandardMaterial({ color: \"#ebe7df\", roughness: 0.82 });",
      "  const ceilingPanelGeometry = new THREE.BoxGeometry(1.8, 0.04, 1.8);",
      "  for (let x = -2; x <= 2; x += 1) {",
      "    for (let z = -2; z <= 2; z += 1) {",
      "      const ceilingPanel = new THREE.Mesh(ceilingPanelGeometry, ceilingPanelMaterial);",
      "      ceilingPanel.position.set(x * 2, 2.97, z * 2);",
      "      root.add(ceilingPanel);",
      "    }",
      "  }",
    ].join("\n"),
  );
}

function chairSceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string; light: string }): string {
  return targetedSceneSource(options).replace(
    "  const ambient = new THREE.HemisphereLight",
    [
      "  const chairMaterial = new THREE.MeshStandardMaterial({ color: \"#6c4428\", roughness: 0.86 });",
      "  const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.68), chairMaterial);",
      "  chairSeat.position.set(-3.2, 0.55, -3.15);",
      "  root.add(chairSeat);",
      "  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.12), chairMaterial);",
      "  chairBack.position.set(-3.2, 1.05, -3.45);",
      "  root.add(chairBack);",
      "  const ambient = new THREE.HemisphereLight",
    ].join("\n"),
  );
}

function doorwaySceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string; light: string }): string {
  const source = targetedSceneSource(options)
    .replace(
      "  const floor = new THREE.Mesh(",
      [
        "  const corridorFloor = new THREE.Mesh(",
        "    new THREE.PlaneGeometry(2, 5),",
        "    new THREE.MeshStandardMaterial({ color: \"#8a8479\", roughness: 1 }),",
        "  );",
        "  corridorFloor.position.z = -7.5;",
        "  corridorFloor.rotation.x = -Math.PI / 2;",
        "  root.add(corridorFloor);",
        "  const floor = new THREE.Mesh(",
      ].join("\n"),
    )
    .replace(
      "  const walls: Array<[number, number, number, number]> = [",
      [
        "  const doorway = { width: 1.8 };",
        "  const northLeftWall = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 3), wallMaterial);",
        "  northLeftWall.position.set(-2.95, 1.5, -5);",
        "  root.add(northLeftWall);",
        "  const northRightWall = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 3), wallMaterial);",
        "  northRightWall.position.set(2.95, 1.5, -5);",
        "  root.add(northRightWall);",
        "  const walls: Array<[number, number, number, number]> = [",
      ].join("\n"),
    )
    .replace("    [0, 1.5, -5, 0],\n", "");
  return source;
}

function highCeilingSceneSource(options: { title: string; background: string; floor: string; wall: string; ceiling: string; light: string }): string {
  return targetedSceneSource(options)
    .replace("  ceiling.position.y = 3;", "  ceiling.position.y = 6;")
    .replace("  const wallGeometry = new THREE.PlaneGeometry(10, 3);", "  const wallGeometry = new THREE.PlaneGeometry(10, 6);")
    .replace("    [0, 1.5, -5, 0],", "    [0, 3, -5, 0],")
    .replace("    [0, 1.5, 5, Math.PI],", "    [0, 3, 5, Math.PI],")
    .replace("    [-5, 1.5, 0, Math.PI / 2],", "    [-5, 3, 0, Math.PI / 2],")
    .replace("    [5, 1.5, 0, -Math.PI / 2],", "    [5, 3, 0, -Math.PI / 2],");
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
