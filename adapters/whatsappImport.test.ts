import { describe, expect, it } from 'vitest';
import { parseWhatsAppTranscript } from '@/domain/whatsappImport';
import { InMemoryChatRepository } from '@/adapters/memoryChat';
import { importWhatsAppConversation } from './whatsappImport';

describe('importWhatsAppConversation', () => {
  it('writes mapped messages into a DM and skips a second paste of the same text', async () => {
    const chat = new InMemoryChatRepository();
    const parsed = parseWhatsAppTranscript(
      `[16:05, 3.9.2026] Andrea: hello slaydex\n[16:06, 3.9.2026] Savi(g)na 🔥: hi from tedi\n`
    );
    const first = await importWhatsAppConversation({
      chat,
      viewer: { id: 'me', nativeLang: 'en', learningLang: 'de' },
      selfSpeaker: 'Andrea',
      otherSpeaker: 'Savi(g)na 🔥',
      partner: { id: 'sav', displayName: 'Savigna', email: 'savigna@savigna.local', username: 'savigna' },
      parsed,
    });
    expect(first.importedCount).toBe(2);
    const messages = await chat.listMessages(first.conversationId);
    expect(messages.map((item) => item.authorId)).toEqual(['me', 'sav']);
    expect(messages[0]?.sourceText).toBe('hello slaydex');

    const second = await importWhatsAppConversation({
      chat,
      viewer: { id: 'me', nativeLang: 'en' },
      selfSpeaker: 'Andrea',
      otherSpeaker: 'Savi(g)na 🔥',
      partner: { id: 'sav', displayName: 'Savigna', email: 'savigna@savigna.local', username: 'savigna' },
      parsed,
    });
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.importedCount).toBe(0);
  });
});
