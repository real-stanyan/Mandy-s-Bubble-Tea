"use client";

import { usePathname } from "next/navigation";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { VoiceOrderButton } from "@/components/chat/VoiceOrderButton";

// Mirrors CartDrawerGate: /staff is an internal tool and /checkout is a
// funnel — neither wants a chat bubble sitting on top of it. /admin is the
// same kind of internal surface as /staff.
const HIDE_PREFIXES = ["/staff", "/admin", "/checkout"];

export function ChatGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return (
    <>
      <VoiceOrderButton />
      <ChatBubble />
      <ChatDrawer />
    </>
  );
}
