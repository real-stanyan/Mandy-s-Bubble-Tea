/**
 * Which version of what was heard actually gets sent.
 *
 * Browsers mark a speech result "final" when they are confident the utterance
 * is over. iOS Safari frequently never does — it just ends the session — and
 * the original code sent only final text, so everything said was thrown away.
 * Seen in the shop on 15 August: "现在店里正常吗" sat correctly in the live
 * transcript, the mic closed, and nothing was sent and nothing said why.
 *
 * The final transcript is better when it exists: it is the browser's settled
 * reading, and interim text can be a half-heard fragment it was about to
 * revise. But a fragment the staff member can see on screen beats silence,
 * and they are looking straight at it.
 *
 * Empty when neither has anything, so a microphone opened by accident in a
 * noisy shop sends no message at all.
 */
export function chooseTranscript(finalText: string, interimText: string): string {
  return (finalText.trim() || interimText.trim()).trim();
}
