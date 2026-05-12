import { describe, expect, it } from "vitest";
import { evaluateSandboxPath } from "../src/server/agent/sandboxPolicy";

describe("sandbox path policy", () => {
  it("allows files inside the active room sandbox", () => {
    const decision = evaluateSandboxPath("/repo/src/client/rooms/active", "roomConfig.ts", "write config");
    expect(decision.allowed).toBe(true);
    expect(decision.permissionRequest).toBeUndefined();
  });

  it("halts with a formal permission request when a path escapes", () => {
    const decision = evaluateSandboxPath("/repo/src/client/rooms/active", "../secrets.ts", "agent requested escape", "apply_patch");
    expect(decision.allowed).toBe(false);
    expect(decision.permissionRequest).toMatchObject({
      reason: "agent requested escape",
      sandboxRoot: "/repo/src/client/rooms/active",
      command: "apply_patch",
    });
  });
});
