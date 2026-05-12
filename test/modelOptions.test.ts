import { describe, expect, it } from "vitest";
import { modelOptions } from "../src/shared/models";

describe("model options", () => {
  it("puts the fastest Codex model first for room edits", () => {
    expect(modelOptions[0]).toMatchObject({
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      posture: "fast",
    });
  });

  it("includes fast, balanced, and deep choices", () => {
    expect(modelOptions.map((model) => model.id)).toEqual([
      "gpt-5.3-codex-spark",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.4",
      "gpt-5.5",
    ]);
  });
});
