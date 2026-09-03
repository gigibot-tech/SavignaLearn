import { sourceMessageFromText } from '@/domain/chat';
import {
  localWhatsAppPartnerId,
  messagesForSpeakers,
  type ParsedWhatsAppMessage,
  type WhatsAppParseResult,
} from '@/domain/whatsappImport';
import { findOrCreateDirectChat } from '@/adapters/friends';
import type { ChatRepository } from '@/ports/ports';

function newImportedId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type WhatsAppImportPartner = {
  id: string;
  displayName: string;
  username?: string;
  email?: string;
};

export async function importWhatsAppConversation(input: {
  chat: ChatRepository;
  viewer: { id: string; nativeLang?: string; learningLang?: string };
  selfSpeaker: string;
  otherSpeaker: string;
  partner: WhatsAppImportPartner;
  parsed: WhatsAppParseResult;
}): Promise<{ conversationId: string; importedCount: number }> {
  const selected = messagesForSpeakers(input.parsed.messages, input.selfSpeaker, input.otherSpeaker);
  if (selected.length === 0) {
    throw new Error('No messages for those two names');
  }

  const partnerId = input.partner.id || localWhatsAppPartnerId(input.otherSpeaker);
  const conversation = await findOrCreateDirectChat(
    input.chat,
    input.viewer,
    {
      id: partnerId,
      username: input.partner.username ?? partnerId.replace(/^wa:/, ''),
      displayName: input.partner.displayName,
      email: input.partner.email ?? `${partnerId.replace(/^wa:/, '')}@whatsapp.local`,
    }
  );

  const existing = await input.chat.listMessages(conversation.id);
  let importedCount = 0;
  const idsByIndex = new Map<number, string>();

  for (const message of selected) {
    const originalIndex = input.parsed.messages.indexOf(message);
    if (alreadyImported(existing, message)) continue;
    const id = newImportedId();
    if (originalIndex >= 0) idsByIndex.set(originalIndex, id);
    const replyToId =
      message.replyToIndex != null ? idsByIndex.get(message.replyToIndex) : undefined;
    const authorId = message.speaker === input.selfSpeaker ? input.viewer.id : partnerId;
    await input.chat.appendMessage(
      sourceMessageFromText({
        id,
        conversationId: conversation.id,
        authorId,
        sourceLang: input.viewer.nativeLang ?? 'en',
        sourceText: message.text,
        receipt: 'read',
        createdAt: message.createdAt,
        replyToId,
      })
    );
    importedCount += 1;
  }

  return { conversationId: conversation.id, importedCount };
}

function alreadyImported(existing: { sourceText: string; createdAt: string }[], message: ParsedWhatsAppMessage) {
  return existing.some(
    (item) => item.sourceText === message.text && item.createdAt === message.createdAt
  );
}
