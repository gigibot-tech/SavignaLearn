-- Public profile card: about, photo, last seen.
-- Friends (any signed-in user) can read; only self can write.

alter table public.savigna_profiles
  add column if not exists bio text not null default '',
  add column if not exists photo_url text,
  add column if not exists last_seen_at timestamptz;

alter table public.savigna_profiles
  drop constraint if exists savigna_profiles_bio_len;
alter table public.savigna_profiles
  add constraint savigna_profiles_bio_len check (char_length(bio) <= 139);

comment on column public.savigna_profiles.bio is
  'WhatsApp-style about text.';
comment on column public.savigna_profiles.photo_url is
  'Avatar data URL or https URL. No storage bucket.';
comment on column public.savigna_profiles.last_seen_at is
  'Client heartbeat while the app is open.';

drop policy if exists savigna_profiles_self on public.savigna_profiles;
drop policy if exists savigna_profiles_select on public.savigna_profiles;
drop policy if exists savigna_profiles_insert on public.savigna_profiles;
drop policy if exists savigna_profiles_update on public.savigna_profiles;
drop policy if exists savigna_profiles_delete on public.savigna_profiles;

create policy savigna_profiles_select on public.savigna_profiles
  for select to authenticated
  using (true);

create policy savigna_profiles_insert on public.savigna_profiles
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy savigna_profiles_update on public.savigna_profiles
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy savigna_profiles_delete on public.savigna_profiles
  for delete to authenticated
  using (user_id = auth.uid()::text);

do $$
begin
  alter publication supabase_realtime add table public.savigna_profiles;
exception
  when duplicate_object then null;
end $$;
