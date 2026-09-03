-- SavignaLearn schema on ido-core Supabase project.
-- Do NOT reuse ai_threads / ai_messages (tutor actor).

create extension if not exists "pgcrypto";

create table if not exists public.savigna_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
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
  id uuid primary key default gen_random_uuid(),
  ai_enabled boolean not null default true,
  pinned boolean not null default false,
  muted boolean not null default false,
  title text,
  last_message_preview text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.savigna_participants (
  conversation_id uuid not null references public.savigna_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  native_lang text not null,
  learning_lang text not null,
  unread_count int not null default 0,
  primary key (conversation_id, user_id)
);

create table if not exists public.savigna_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.savigna_conversations (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  source_lang text not null,
  source_text text not null,
  lines jsonb not null default '[]'::jsonb,
  kind text not null default 'user' check (kind in ('user', 'ai', 'system')),
  reply_to uuid references public.savigna_messages (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  receipt text not null default 'sent' check (receipt in ('pending', 'sent', 'delivered', 'read', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists savigna_messages_conversation_created_idx
  on public.savigna_messages (conversation_id, created_at);

create table if not exists public.savigna_line_translations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.savigna_messages (id) on delete cascade,
  line_index int not null,
  target_lang text not null,
  mode text not null check (mode in ('lines', 'birkenbihl')),
  text text not null,
  created_at timestamptz not null default now(),
  unique (message_id, line_index, target_lang, mode)
);

-- Gigolingo Word-compatible columns + tagged LearningSource jsonb.
create table if not exists public.savigna_learning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
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

alter table public.savigna_profiles enable row level security;
alter table public.savigna_conversations enable row level security;
alter table public.savigna_participants enable row level security;
alter table public.savigna_messages enable row level security;
alter table public.savigna_line_translations enable row level security;
alter table public.savigna_learning_items enable row level security;

create or replace function public.savigna_is_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.savigna_participants p
    where p.conversation_id = cid and p.user_id = auth.uid()
  );
$$;

create policy savigna_profiles_self on public.savigna_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy savigna_participants_rw on public.savigna_participants
  for all using (public.savigna_is_participant(conversation_id) or user_id = auth.uid())
  with check (user_id = auth.uid());

create policy savigna_conversations_rw on public.savigna_conversations
  for all using (public.savigna_is_participant(id))
  with check (true);

create policy savigna_messages_rw on public.savigna_messages
  for all using (public.savigna_is_participant(conversation_id))
  with check (public.savigna_is_participant(conversation_id));

create policy savigna_translations_rw on public.savigna_line_translations
  for all using (
    exists (
      select 1 from public.savigna_messages m
      where m.id = message_id and public.savigna_is_participant(m.conversation_id)
    )
  )
  with check (
    exists (
      select 1 from public.savigna_messages m
      where m.id = message_id and public.savigna_is_participant(m.conversation_id)
    )
  );

create policy savigna_learning_items_self on public.savigna_learning_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table public.savigna_messages;
