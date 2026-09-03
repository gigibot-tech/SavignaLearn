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
import type { AuthPort, AuthUser, ChatRepository } from '@/ports/ports';
import { MixedAuthAdapter, isMixedIdentityConfigured } from '@/adapters/mixedAuth';
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
    client = createClient(url, anonKey, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'savignalearn.auth.token',
      },
    });
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
  lines: MessageLine[];
  kind: SourceMessage['kind'];
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  receipt: ReceiptStatus;
  created_at: string;
};

function rowToMessage(row: MessageRow): SourceMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorId: row.author_id,
    sourceLang: row.source_lang,
    sourceText: row.source_text,
    lines: row.lines ?? [],
    kind: row.kind,
    replyToId: row.reply_to ?? undefined,
    editedAt: row.edited_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    receipt: row.receipt,
    createdAt: row.created_at,
  };
}

/** Realtime ChatRepository against savigna_* tables (ido-core project). */
export class SupabaseChatRepository implements ChatRepository {
  private client = getSupabaseClient();

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

    return (conversations ?? []).map((c) => {
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
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const list = await this.listConversations((await this.client.auth.getUser()).data.user?.id ?? '');
    return list.find((c) => c.id === id) ?? null;
  }

  async createConversation(input: {
    participantIds: string[];
    participants: Conversation['participants'];
    aiEnabled: boolean;
    title?: string;
  }): Promise<Conversation> {
    const { data: conv, error } = await this.client
      .from('savigna_conversations')
      .insert({ ai_enabled: input.aiEnabled, title: input.title ?? null })
      .select('*')
      .single();
    if (error || !conv) throw error ?? new Error('create conversation failed');

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
    return (data ?? []).map((row) => rowToMessage(row as MessageRow));
  }

  async appendMessage(message: SourceMessage): Promise<SourceMessage> {
    const { data, error } = await this.client
      .from('savigna_messages')
      .insert({
        id: message.id,
        conversation_id: message.conversationId,
        author_id: message.authorId,
        source_lang: message.sourceLang,
        source_text: message.sourceText,
        lines: message.lines,
        kind: message.kind,
        reply_to: message.replyToId ?? null,
        receipt: message.receipt,
        created_at: message.createdAt,
      })
      .select('*')
      .single();
    if (error || !data) throw error ?? new Error('append failed');

    await this.client
      .from('savigna_conversations')
      .update({
        last_message_preview: message.sourceText.split('\n')[0],
        updated_at: message.createdAt,
      })
      .eq('id', message.conversationId);

    return rowToMessage(data as MessageRow);
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
    const rows = translations.map((t) => ({
      message_id: messageId,
      line_index: t.lineIndex,
      target_lang: t.targetLang,
      mode: t.mode,
      text: t.text,
    }));
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
    return (data ?? []).map((row) => ({
      lineIndex: row.line_index as number,
      targetLang: row.target_lang as string,
      mode: row.mode as LineTranslation['mode'],
      text: row.text as string,
    }));
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
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}

