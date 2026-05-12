export interface ModelOption {
  id: string;
  label: string;
  posture: "fast" | "balanced" | "deep";
}

export const modelOptions: ModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5", posture: "deep" },
  { id: "gpt-5.4", label: "GPT-5.4", posture: "balanced" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", posture: "fast" },
];
