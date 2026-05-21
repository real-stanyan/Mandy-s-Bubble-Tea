import type { CupLabelSelection } from "@/store/cart";

const PROMPT_PREVIEW_MAX = 32;

export function summaryFor(selection: CupLabelSelection | undefined): string {
  if (!selection) return "Pick a design";
  if (selection.kind === "preset") return `🎨 ${selection.hash.slice(0, 8)}…`;
  if (selection.kind === "photo") return "📷 Your photo";
  const prompt = selection.prompt;
  const truncated = prompt.length > PROMPT_PREVIEW_MAX;
  const head = truncated ? prompt.slice(0, PROMPT_PREVIEW_MAX) : prompt;
  const pending = selection.aiDoodleId === null ? " (working…)" : "";
  return `✨ AI · ${head}${truncated ? "…" : ""}${pending}`;
}
