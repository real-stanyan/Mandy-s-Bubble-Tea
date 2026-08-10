"use client";

import { usePathname } from "next/navigation";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { VoiceOrderButton } from "@/components/chat/VoiceOrderButton";

// Mirrors CartDrawerGate: /staff is an internal tool and /checkout is a
// funnel — neither wants a chat bubble sitting on top of it. /admin is the
// same kind of internal surface as /staff.
const HIDE_PREFIXES = ["/staff", "/admin", "/checkout"];

/** Master switch for every voice affordance (order pill + per-reply
 *  speaker). Flip to true to bring voice back — nothing else to change. */
export const VOICE_ENABLED = false;

export function ChatGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return (
    <>
      {/* Voice ordering is built but OFF (Stan, 2026-08-10 — "语音功能先下线").
          The button, the /api/chat/tts endpoint, and the speaker control all
          stay in the tree behind this flag so re-enabling is a one-line
          change when the voice project resumes (P3, see the App repo's
          voice-assistant spec). */}
      {VOICE_ENABLED ? <VoiceOrderButton /> : null}
      <ChatBubble />
      <ChatDrawer />
    </>
  );
}
