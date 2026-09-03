create table if not exists public.savigna_message_hides (
  user_id text not null,
  message_id text not null references public.savigna_messages (id) on delete cascade,
  conversation_id text not null references public.savigna_conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists savigna_message_hides_conversation_idx
  on public.savigna_message_hides (conversation_id, user_id);

alter table public.savigna_message_hides enable row level security;

drop policy if exists savigna_message_hides_self on public.savigna_message_hides;
create policy savigna_message_hides_self on public.savigna_message_hides
  for all
  using (
    user_id = auth.uid()::text
    and savigna_private.is_participant(conversation_id)
  )
  with check (
    user_id = auth.uid()::text
    and savigna_private.is_participant(conversation_id)
  );

grant select, insert, delete on public.savigna_message_hides to authenticated;

comment on table public.savigna_message_hides is
  'Per-user delete-for-me. Delete-for-everyone uses savigna_messages.deleted_at.';

do $$
begin
  alter publication supabase_realtime add table public.savigna_message_hides;
exception
  when duplicate_object then null;
end $$;
