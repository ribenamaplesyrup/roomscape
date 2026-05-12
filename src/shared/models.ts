export interface ModelOption {
  id: string;
  label: string;
  posture: "fast" | "balanced" | "deep";
}

export const modelOptions: ModelOption[] = [
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", posture: "fast" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", posture: "fast" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", posture: "balanced" },
  { id: "gpt-5.2", label: "GPT-5.2", posture: "balanced" },
  { id: "gpt-5.4", label: "GPT-5.4", posture: "balanced" },
  { id: "gpt-5.5", label: "GPT-5.5", posture: "deep" },
];
