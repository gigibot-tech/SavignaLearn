export type SendInputType = 'text' | 'image' | 'retry';

/**
 * Pure predicate that decides whether the bot should generate a new AI reply.
 *
 * Important: bubble-level `Retry` is meant to only re-compute translations for an
 * existing user message; it must not trigger a new bot response.
 */
export function shouldAutoReplyFromSendInput(
  inputType: SendInputType,
  ctx: {
    botReplies: boolean;
    talkingToBot: boolean;
    isMediaMessage: boolean;
  }
): boolean {
  if (inputType === 'retry') return false;
  return ctx.botReplies && ctx.talkingToBot && !ctx.isMediaMessage;
}

