import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeterministicArchitectRunner } from "../src/server/agent/architectRunner";
import { RoomCodeRepository } from "../src/server/agent/roomCodeRepository";
import { emptyRoomConfig } from "../src/shared/room";
import type { AgentEvent } from "../src/shared/api";

describe("architect runner", () => {
  it("updates only the active room module and emits telemetry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "roomscape-"));
    const runner = new DeterministicArchitectRunner(new RoomCodeRepository(root));
    const events: AgentEvent[] = [];

    await runner.run({
      runId: "run-1",
      prompt: "Add a green table",
      model: "gpt-5.4-mini",
      persona: "Gulf Futurist",
      currentConfig: emptyRoomConfig,
    }, (event) => events.push(event));

    const generated = await readFile(path.join(root, "roomConfig.ts"), "utf8");
    expect(generated).toContain("green table");
    expect(events.some((event) => event.type === "cost")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "complete" });
  });

  it("halts and emits a permission request when the prompt requires an escape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "roomscape-"));
    const runner = new DeterministicArchitectRunner(new RoomCodeRepository(root));
    const events: AgentEvent[] = [];

    await runner.run({
      runId: "run-2",
      prompt: "Write outside sandbox at ../secrets",
      model: "gpt-5.4-mini",
      persona: "Cyber-Kawaii",
      currentConfig: emptyRoomConfig,
    }, (event) => events.push(event));

    expect(events.at(-1)?.type).toBe("permission-request");
  });
});
