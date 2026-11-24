/**
 * ido-core Supabase client + AuthPort.
 * Storage key isolated so this PWA does not clobber ido-core sessions.
 */

import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Conversation,
  LineTranslation,
  MessageLine,
  ReceiptStatus,
  SourceMessage,
} from '@/domain/chat';
import { conversationPreviewFor, DELETED_FOR_EVERYONE_COPY, mediaKindOf } from '@/domain/chat';
import { canDeleteForEveryone, previewAfterDelete, tombstoneMessage } from '@/domain/messageDelete';
import { unreadRecipients } from '@/domain/inbox';
import type { AuthPort, AuthUser, ChatContentCipher, ChatRepository } from '@/ports/ports';
import { MixedAuthAdapter, isMixedIdentityConfigured } from '@/adapters/mixedAuth';
import { supabaseAuthClientOptions } from '@/adapters/supabaseClientOptions';
import {
  authStorage,
  clearLocalDemoSession,
  loadLocalDemoSession,
  saveLocalDemoSession,
} from '@/adapters/authStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return url.startsWith('http') && anonKey.length > 20;
}

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (!client) {
    client = createClient(url, anonKey, supabaseAuthClientOptions('savignalearn.auth.token'));
  }
  return client;
}

function toAuthUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  return {
    id: user.id,
    email: user.email ?? undefined,
    displayName:
      (typeof user.user_metadata?.display_name === 'string'
        ? user.user_metadata.display_name
        : undefined) ?? user.email ?? undefined,
  };
}

export class SupabaseAuthAdapter implements AuthPort {
  async getSession(): Promise<AuthUser | null> {
    if (!isSupabaseConfigured()) return null;
    const { data } = await getSupabaseClient().auth.getSession();
    return data.session?.user ? toAuthUser(data.session.user) : null;
  }

  async signInWithPassword(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error || !data.user) throw error ?? new Error('Sign-in failed');
    return toAuthUser(data.user);
  }

  async signUp(email: string, password: string, displayName?: string): Promise<AuthUser> {
    const { data, error } = await getSupabaseClient().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error || !data.user) throw error ?? new Error('Sign-up failed');
    return toAuthUser(data.user);
  }

  async signOut(): Promise<void> {
    if (!isSupabaseConfigured()) return;
    await getSupabaseClient().auth.signOut();
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    if (!isSupabaseConfigured()) {
      listener(null);
      return () => undefined;
    }
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      listener(session?.user ? toAuthUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }
}

/** Local-only auth when neither fourSome nor iDO identity is configured. Starts signed out. */
export class DemoAuthAdapter implements AuthPort {
  private user: AuthUser | null = null;
  private listeners = new Set<(user: AuthUser | null) => void>();

  async getSession(): Promise<AuthUser | null> {
    if (this.user) return this.user;
    this.user = await loadLocalDemoSession();
    return this.user;
  }

  async signInWithPassword(email: string, _password: string): Promise<AuthUser> {
    this.user = { id: 'demo-user', email, displayName: email.split('@')[0] };
    await saveLocalDemoSession(this.user);
    this.emit();
    return this.user;
  }

  async signUp(email: string, password: string, displayName?: string): Promise<AuthUser> {
    return this.signInWithPassword(email, password).then((user) => ({
      ...user,
      displayName: displayName ?? user.displayName,
    }));
  }

  async signOut(): Promise<void> {
    this.user = null;
    await clearLocalDemoSession();
    this.emit();
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.user);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.user);
  }
}

export function createAuthPort(): AuthPort {
  if (isMixedIdentityConfigured()) return new MixedAuthAdapter();
  if (isSupabaseConfigured()) return new SupabaseAuthAdapter();
  return new DemoAuthAdapter();
}

type MessageRow = {
  id: string;
  conversation_id: string;
  author_id: string;
  source_lang: string;
  source_text: string;
  enc_version?: number | null;
  enc_alg?: string | null;
  lines: MessageLine[];
  lines_cipher?: string | null;
  kind: SourceMessage['kind'];
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  receipt: ReceiptStatus;
  created_at: string;
};

async function rowToMessage(row: MessageRow, cipher: ChatContentCipher): Promise<SourceMessage> {
  const sourceText = await cipher.open({
    ciphertext: row.source_text,
    encVersion: row.enc_version,
    encAlg: row.enc_alg,
  });
  let lines = row.lines ?? [];
  if (row.lines_cipher) {
    const raw = await cipher.open({
      ciphertext: row.lines_cipher,
      encVersion: row.enc_version,
      encAlg: row.enc_alg,
    });
    lines = JSON.parse(raw) as MessageLine[];
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    sourceLang: row.source_lang,
    sourceText,
    lines,
    kind: row.kind,
    mediaKind: mediaKindOf({ lines }),
    replyToId: row.reply_to ?? undefined,
    editedAt: row.edited_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    receipt: row.receipt,
    createdAt: row.created_at,
  };
}

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  return error?.code === '42P01' || /savigna_message_hides|does not exist/i.test(message);
}

/** Realtime ChatRepository against savigna_* tables (iDO Auth project). */
export class SupabaseChatRepository implements ChatRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly cipher: ChatContentCipher
  ) {}

  async listConversations(userId: string): Promise<Conversation[]> {
    const { data: parts, error } = await this.client
      .from('savigna_participants')
      .select('conversation_id, native_lang, learning_lang, unread_count')
      .eq('user_id', userId);
    if (error) throw error;
    const ids = (parts ?? []).map((p) => p.conversation_id);
    if (ids.length === 0) return [];

    const { data: conversations, error: cErr } = await this.client
      .from('savigna_conversations')
      .select('*')
      .in('id', ids)
      .order('updated_at', { ascending: false });
    if (cErr) throw cErr;

    const { data: allParts } = await this.client
      .from('savigna_participants')
      .select('*')
      .in('conversation_id', ids);

    const mapped = (conversations ?? []).map((c) => {
      const mine = (parts ?? []).find((p) => p.conversation_id === c.id);
      const participants = (allParts ?? [])
        .filter((p) => p.conversation_id === c.id)
        .map((p) => ({
          userId: p.user_id as string,
          nativeLang: p.native_lang as string,
          learningLang: p.learning_lang as string,
        }));
      return {
        id: c.id as string,
        participantIds: participants.map((p) => p.userId),
        participants,
        aiEnabled: Boolean(c.ai_enabled),
        pinned: Boolean(c.pinned),
        muted: Boolean(c.muted),
        title: (c.title as string) ?? undefined,
        updatedAt: c.updated_at as string,
        lastMessagePreview: (c.last_message_preview as string) ?? undefined,
        unreadCount: (mine?.unread_count as number) ?? 0,
      } satisfies Conversation;
    });
    return this.overlayViewerPreviews(mapped, userId);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const { data } = await this.client.auth.getUser();
    const userId = data.user?.id ?? '';
    if (!userId) return null;
    const list = await this.listConversations(userId);
    return list.find((c) => c.id === id) ?? null;
  }

  async createConversation(input: {
    id?: string;
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    if (input.id) {
      const existing = await this.getConversation(input.id);
      if (existing) return existing;
    }
    const insert: Record<string, unknown> = {
      ai_enabled: input.aiEnabled,
      title: input.title ?? null,
    };
    if (input.id) insert.id = input.id;
    const { data: conv, error } = await this.client
      .from('savigna_conversations')
      .insert(insert)
      .select('*')
      .single();
    if (error || !conv) {
      if (input.id && (error?.code === '23505' || /duplicate/i.test(error?.message ?? ''))) {
        const raced = await this.getConversation(input.id);
        if (raced) return raced;
      }
      throw error ?? new Error('create conversation failed');
    }

    const rows = input.participants.map((p) => ({
      conversation_id: conv.id,
      user_id: p.userId,
      native_lang: p.nativeLang,
      learning_lang: p.learningLang,
    }));
    const { error: pErr } = await this.client.from('savigna_participants').insert(rows);
    if (pErr) throw pErr;

    return {
      id: conv.id,
      participantIds: input.participantIds,
      participants: input.participants,
      aiEnabled: input.aiEnabled,
      updatedAt: conv.updated_at,
      unreadCount: 0,
      title: input.title ?? (conv.title as string | undefined),
    };
  }

  async listMessages(conversationId: string): Promise<SourceMessage[]> {
    const { data, error } = await this.client
      .from('savigna_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return Promise.all((data ?? []).map((row) => rowToMessage(row as MessageRow, this.cipher)));
  }

  async appendMessage(message: SourceMessage): Promise<SourceMessage> {
    const sealed = await this.cipher.seal(message.sourceText);
    const encryptLines = this.cipher.alg !== 'none';
    const sealedLines = encryptLines
      ? await this.cipher.seal(JSON.stringify(message.lines))
      : null;
    const { data, error } = await this.client
      .from('savigna_messages')
      .insert({
        id: message.id,
        conversation_id: message.conversationId,
        author_id: message.authorId,
        source_lang: message.sourceLang,
        source_text: sealed.ciphertext,
        enc_version: sealed.encVersion,
        enc_alg: sealed.encAlg,
        lines: encryptLines ? [] : message.lines,
        lines_cipher: sealedLines?.ciphertext ?? null,
        kind: message.kind,
        reply_to: message.replyToId ?? null,
        receipt: message.receipt,
        created_at: message.createdAt,
      })
      .select('*')
      .single();
    if (error || !data) {
      if (message.id && (error?.code === '23505' || /duplicate/i.test(error?.message ?? ''))) {
        const { data: existing } = await this.client
          .from('savigna_messages')
          .select('*')
          .eq('id', message.id)
          .maybeSingle();
        if (existing) {
          const current = await rowToMessage(existing as MessageRow, this.cipher);
          if (message.deletedAt && !current.deletedAt) {
            return this.applyTombstone(message);
          }
          if (message.sourceLang && message.sourceLang !== current.sourceLang) {
            const { error: patchError } = await this.client
              .from('savigna_messages')
              .update({ source_lang: message.sourceLang })
              .eq('id', message.id);
            if (!patchError) return { ...current, sourceLang: message.sourceLang };
          }
          return current;
        }
      }
      throw error ?? new Error('append failed');
    }

    await this.client
      .from('savigna_conversations')
      .update({
        last_message_preview: conversationPreviewFor(message),
        updated_at: message.createdAt,
      })
      .eq('id', message.conversationId);

    if (!message.deletedAt) {
      await this.bumpUnread(message.conversationId, message.authorId);
    }

    return rowToMessage(data as MessageRow, this.cipher);
  }

  async deleteMessage(input: {
    messageId: string;
    conversationId: string;
    actorId: string;
    scope: 'me' | 'everyone';
    viewerIds?: string[];
  }): Promise<SourceMessage | null> {
    if (input.scope === 'me') {
      const { error } = await this.client.from('savigna_message_hides').upsert(
        {
          user_id: input.actorId,
          message_id: input.messageId,
          conversation_id: input.conversationId,
        },
        { onConflict: 'user_id,message_id' }
      );
      if (error) throw error;
      const { data } = await this.client
        .from('savigna_messages')
        .select('*')
        .eq('id', input.messageId)
        .maybeSingle();
      return data ? rowToMessage(data as MessageRow, this.cipher) : null;
    }

    const { data: existing } = await this.client
      .from('savigna_messages')
      .select('*')
      .eq('id', input.messageId)
      .maybeSingle();
    if (!existing) return null;
    const message = await rowToMessage(existing as MessageRow, this.cipher);
    if (!canDeleteForEveryone(message, input.viewerIds ?? [input.actorId])) {
      throw new Error('Cannot delete this message for everyone');
    }
    return this.applyTombstone(message);
  }

  async listHiddenMessageIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('savigna_message_hides')
      .select('message_id')
      .eq('user_id', userId);
    if (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
    return (data ?? []).map((row) => row.message_id as string);
  }

  async markConversationRead(conversationId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    const { error } = await this.client
      .from('savigna_participants')
      .update({ unread_count: 0 })
      .eq('conversation_id', conversationId)
      .in('user_id', unique);
    if (error) throw error;
  }

  async updateReceipt(messageId: string, receipt: ReceiptStatus): Promise<void> {
    const { error } = await this.client
      .from('savigna_messages')
      .update({ receipt })
      .eq('id', messageId);
    if (error) throw error;
  }

  async saveTranslations(messageId: string, translations: LineTranslation[]): Promise<void> {
    if (translations.length === 0) return;
    const rows = await Promise.all(
      translations.map(async (t) => {
        const sealed = await this.cipher.seal(t.text);
        return {
          message_id: messageId,
          line_index: t.lineIndex,
          target_lang: t.targetLang,
          mode: t.mode,
          text: sealed.ciphertext,
          enc_version: sealed.encVersion,
          enc_alg: sealed.encAlg,
        };
      })
    );
    const { error } = await this.client.from('savigna_line_translations').upsert(rows, {
      onConflict: 'message_id,line_index,target_lang,mode',
    });
    if (error) throw error;
  }

  async listTranslations(messageId: string): Promise<LineTranslation[]> {
    const { data, error } = await this.client
      .from('savigna_line_translations')
      .select('*')
      .eq('message_id', messageId);
    if (error) throw error;
    return Promise.all(
      (data ?? []).map(async (row) => ({
        lineIndex: row.line_index as number,
        targetLang: row.target_lang as string,
        mode: row.mode as LineTranslation['mode'],
        text: await this.cipher.open({
          ciphertext: row.text as string,
          encVersion: row.enc_version as number | null,
          encAlg: row.enc_alg as string | null,
        }),
      }))
    );
  }

  async updateParticipants(
    conversationId: string,
    participants: Conversation['participants']
  ): Promise<void> {
    for (const p of participants) {
      const { error } = await this.client
        .from('savigna_participants')
        .update({ native_lang: p.nativeLang, learning_lang: p.learningLang })
        .eq('conversation_id', conversationId)
        .eq('user_id', p.userId);
      if (error) throw error;
    }
  }

  subscribe(conversationId: string, onChange: (messages: SourceMessage[]) => void): () => void {
    const channel = this.client
      .channel(`savigna-messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'savigna_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void this.listMessages(conversationId).then(onChange);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'savigna_message_hides',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void this.listMessages(conversationId).then(onChange);
        }
      )
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  private async applyTombstone(message: SourceMessage): Promise<SourceMessage> {
    const tombstone = tombstoneMessage(message);
    const sealed = await this.cipher.seal('');
    const encryptLines = this.cipher.alg !== 'none';
    const sealedLines = encryptLines ? await this.cipher.seal(JSON.stringify(tombstone.lines)) : null;
    const { error } = await this.client
      .from('savigna_messages')
      .update({
        deleted_at: tombstone.deletedAt,
        source_text: sealed.ciphertext,
        enc_version: sealed.encVersion,
        enc_alg: sealed.encAlg,
        lines: encryptLines ? [] : tombstone.lines,
        lines_cipher: sealedLines?.ciphertext ?? null,
      })
      .eq('id', message.id)
      .eq('author_id', message.authorId);
    if (error) throw error;
    await this.client.from('savigna_line_translations').delete().eq('message_id', message.id);
    const messages = await this.listMessages(message.conversationId);
    const last = messages[messages.length - 1];
    await this.client
      .from('savigna_conversations')
      .update({
        last_message_preview: last ? conversationPreviewFor(last) : DELETED_FOR_EVERYONE_COPY,
        updated_at: tombstone.deletedAt,
      })
      .eq('id', message.conversationId);
    return tombstone;
  }

  private async bumpUnread(conversationId: string, authorId: string): Promise<void> {
    const { data, error } = await this.client
      .from('savigna_participants')
      .select('user_id, unread_count')
      .eq('conversation_id', conversationId);
    if (error || !data) return;
    const targets = unreadRecipients(
      data.map((row) => row.user_id as string),
      authorId
    );
    for (const userId of targets) {
      const current = data.find((row) => row.user_id === userId);
      const next = (current?.unread_count as number | undefined ?? 0) + 1;
      await this.client
        .from('savigna_participants')
        .update({ unread_count: next })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
    }
  }

  private async overlayViewerPreviews(
    conversations: Conversation[],
    userId: string
  ): Promise<Conversation[]> {
    if (conversations.length === 0) return conversations;
    const hidden = new Set(await this.listHiddenMessageIds(userId).catch(() => []));
    if (hidden.size === 0) return conversations;
    const ids = conversations.map((item) => item.id);
    const { data, error } = await this.client
      .from('savigna_messages')
      .select('*')
      .in('conversation_id', ids)
      .order('created_at', { ascending: true });
    if (error || !data) return conversations;
    const byConv = new Map<string, SourceMessage[]>();
    for (const row of data) {
      const message = await rowToMessage(row as MessageRow, this.cipher);
      const list = byConv.get(message.conversationId) ?? [];
      list.push(message);
      byConv.set(message.conversationId, list);
    }
    return conversations.map((conversation) => ({
      ...conversation,
      lastMessagePreview: previewAfterDelete(
        byConv.get(conversation.id) ?? [],
        hidden,
        conversationPreviewFor
      ),
    }));
  }
}

