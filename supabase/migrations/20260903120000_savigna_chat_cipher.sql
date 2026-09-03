-- SavignaLearn chat on the iDO Auth project (namespaced savigna_* only).
-- Text ids so SavignasBoi (`savigna-ai`) and client ids work.
-- enc_version / enc_alg: v0 + `none` is plaintext; swap ChatContentCipher later.

create extension if not exists "pgcrypto";

create schema if not exists savigna_private;
revoke all on schema savigna_private from public;

create table if not exists public.savigna_profiles (
  user_id text primary key,
  native_lang text not null default 'en',
  learning_lang text not null default 'de',
  presence_opt_in boolean not null default true,
  ai_opt_in_default boolean not null default true,
  density text not null default 'comfortable' check (density in ('comfortable', 'compact')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.savigna_conversations (
  id text primary key default gen_random_uuid()::text,
  created_by text not null default (auth.uid()::text),
  ai_enabled boolean not null default true,
  pinned boolean not null default false,
  muted boolean not null default false,
  title text,
  last_message_preview text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.savigna_participants (
  conversation_id text not null references public.savigna_conversations (id) on delete cascade,
  user_id text not null,
  native_lang text not null,
  learning_lang text not null,
  unread_count int not null default 0,
  primary key (conversation_id, user_id)
);

create table if not exists public.savigna_messages (
  id text primary key,
  conversation_id text not null references public.savigna_conversations (id) on delete cascade,
  author_id text not null,
  source_lang text not null,
  source_text text not null,
  enc_version int not null default 0,
  enc_alg text not null default 'none',
  lines jsonb not null default '[]'::jsonb,
  lines_cipher text,
  kind text not null default 'user' check (kind in ('user', 'ai', 'system')),
  reply_to text references public.savigna_messages (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  receipt text not null default 'sent' check (receipt in ('pending', 'sent', 'delivered', 'read', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists savigna_messages_conversation_created_idx
  on public.savigna_messages (conversation_id, created_at);

create table if not exists public.savigna_line_translations (
  id text primary key default gen_random_uuid()::text,
  message_id text not null references public.savigna_messages (id) on delete cascade,
  line_index int not null,
  target_lang text not null,
  mode text not null check (mode in ('lines', 'birkenbihl')),
  text text not null,
  enc_version int not null default 0,
  enc_alg text not null default 'none',
  created_at timestamptz not null default now(),
  unique (message_id, line_index, target_lang, mode)
);

create table if not exists public.savigna_learning_items (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  word text not null,
  translation text not null default '',
  sentence_orig text not null default '',
  sentence_eng text not null default '',
  sentence_reading text,
  reading text not null default '',
  language text,
  language_level text,
  frequency text,
  jlpt text,
  progress int default 0,
  seen_count int default 0,
  correct_count int default 0,
  ease_factor numeric default 2.5,
  interval_days int default 1,
  repetitions int default 0,
  quality int,
  source jsonb not null default '{"kind":"manual"}'::jsonb,
  date_added timestamptz not null default now(),
  last_reviewed timestamptz,
  next_review timestamptz
);

create index if not exists savigna_learning_items_user_word_idx
  on public.savigna_learning_items (user_id, word);

comment on column public.savigna_messages.enc_alg is
  'ChatContentCipher id. none = plaintext (v0). Future: aes-gcm-v1 etc.';
comment on column public.savigna_line_translations.enc_alg is
  'Same cipher module as savigna_messages.enc_alg.';

create or replace function savigna_private.is_participant(cid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.savigna_participants p
    where p.conversation_id = cid and p.user_id = auth.uid()::text
  );
$$;

revoke all on function savigna_private.is_participant(text) from public;
grant execute on function savigna_private.is_participant(text) to authenticated;

alter table public.savigna_profiles enable row level security;
alter table public.savigna_conversations enable row level security;
alter table public.savigna_participants enable row level security;
alter table public.savigna_messages enable row level security;
alter table public.savigna_line_translations enable row level security;
alter table public.savigna_learning_items enable row level security;

drop policy if exists savigna_profiles_self on public.savigna_profiles;
create policy savigna_profiles_self on public.savigna_profiles
  for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

drop policy if exists savigna_participants_rw on public.savigna_participants;
drop policy if exists savigna_participants_select on public.savigna_participants;
drop policy if exists savigna_participants_insert on public.savigna_participants;
drop policy if exists savigna_participants_update on public.savigna_participants;
drop policy if exists savigna_participants_delete on public.savigna_participants;

create policy savigna_participants_select on public.savigna_participants
  for select using (
    user_id = auth.uid()::text
    or savigna_private.is_participant(conversation_id)
  );
create policy savigna_participants_insert on public.savigna_participants
  for insert with check (
    user_id = auth.uid()::text
    or user_id = 'savigna-ai'
    or exists (
      select 1 from public.savigna_conversations c
      where c.id = conversation_id and c.created_by = auth.uid()::text
    )
  );
create policy savigna_participants_update on public.savigna_participants
  for update using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy savigna_participants_delete on public.savigna_participants
  for delete using (user_id = auth.uid()::text);

drop policy if exists savigna_conversations_rw on public.savigna_conversations;
drop policy if exists savigna_conversations_select on public.savigna_conversations;
drop policy if exists savigna_conversations_insert on public.savigna_conversations;
drop policy if exists savigna_conversations_update on public.savigna_conversations;

create policy savigna_conversations_select on public.savigna_conversations
  for select using (
    savigna_private.is_participant(id)
    or created_by = auth.uid()::text
  );
create policy savigna_conversations_insert on public.savigna_conversations
  for insert with check (created_by = auth.uid()::text);
create policy savigna_conversations_update on public.savigna_conversations
  for update using (savigna_private.is_participant(id) or created_by = auth.uid()::text);

drop policy if exists savigna_messages_rw on public.savigna_messages;
create policy savigna_messages_rw on public.savigna_messages
  for all using (savigna_private.is_participant(conversation_id))
  with check (savigna_private.is_participant(conversation_id));

drop policy if exists savigna_translations_rw on public.savigna_line_translations;
create policy savigna_translations_rw on public.savigna_line_translations
  for all using (
    exists (
      select 1 from public.savigna_messages m
      where m.id = message_id and savigna_private.is_participant(m.conversation_id)
    )
  )
  with check (
    exists (
      select 1 from public.savigna_messages m
      where m.id = message_id and savigna_private.is_participant(m.conversation_id)
    )
  );

drop policy if exists savigna_learning_items_self on public.savigna_learning_items;
create policy savigna_learning_items_self on public.savigna_learning_items
  for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

grant select, insert, update, delete on public.savigna_profiles to authenticated;
grant select, insert, update, delete on public.savigna_conversations to authenticated;
grant select, insert, update, delete on public.savigna_participants to authenticated;
grant select, insert, update, delete on public.savigna_messages to authenticated;
grant select, insert, update, delete on public.savigna_line_translations to authenticated;
grant select, insert, update, delete on public.savigna_learning_items to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.savigna_messages;
exception
  when duplicate_object then null;
end $$;
