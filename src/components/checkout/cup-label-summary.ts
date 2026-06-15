import type { CupLabelSelection } from "@/store/cart";

const PROMPT_PREVIEW_MAX = 32;

export function summaryFor(selection: CupLabelSelection | undefined): string {
  if (!selection) return "🧋 Mandy logo";
  if (selection.kind === "preset") return "🎨 Gallery design";
  if (selection.kind === "photo") return "📷 Your photo";
  if (selection.kind === "draw") {
    const pending = selection.userDoodleId === null ? " (saving…)" : "";
    return `✏️ Your drawing${pending}`;
  }
  const prompt = selection.prompt;
  const truncated = prompt.length > PROMPT_PREVIEW_MAX;
  const head = truncated ? prompt.slice(0, PROMPT_PREVIEW_MAX) : prompt;
  const pending = selection.aiDoodleId === null ? " (working…)" : "";
  return `✨ AI · ${head}${truncated ? "…" : ""}${pending}`;
}
