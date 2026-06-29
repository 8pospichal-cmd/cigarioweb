-- ════════════════════════════════════════════════════════════════
-- CIGARIO BUSINESS — schéma + RLS pro partner portál
-- Spusť CELÉ v Supabase → SQL Editor. Bezpečné spustit i opakovaně.
-- ════════════════════════════════════════════════════════════════

-- 1) ADMINI (kdo smí moderovat) ----------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ⚠️ OVĚŘ, že je to TVOJE uid (v appce je to CREATOR_UID). Když ne, změň ho.
insert into public.admins (user_id)
values ('7882c3dd-25ce-4149-a118-db65175bccc3')
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- 2) ROZŠÍŘENÍ smoking_places ------------------------------------
alter table public.smoking_places
  add column if not exists owner_user_id   uuid references auth.users(id) on delete set null,
  add column if not exists status          text not null default 'pending',
  add column if not exists moderation_note text,
  add column if not exists submitted_at    timestamptz default now(),
  add column if not exists moderated_at    timestamptz;

-- Všechna STÁVAJÍCÍ (kurátorská) místa jsou schválená → ať nezmizí z appky.
update public.smoking_places
  set status = 'approved'
  where status is null or status <> 'approved';

-- Povolené hodnoty status
do $$ begin
  alter table public.smoking_places
    add constraint smoking_places_status_chk
    check (status in ('draft','pending','approved','hidden'));
exception when duplicate_object then null; end $$;

create index if not exists smoking_places_owner_idx  on public.smoking_places(owner_user_id);
create index if not exists smoking_places_status_idx on public.smoking_places(status);

-- 3) RLS na smoking_places ---------------------------------------
-- POZOR: zapnutím RLS appka uvidí jen 'approved' (přesně co chceme).
alter table public.smoking_places enable row level security;

-- Čtení: veřejnost/appka jen approved; majitel svá; admin vše
drop policy if exists sp_select_public on public.smoking_places;
create policy sp_select_public on public.smoking_places
  for select using (status = 'approved');

drop policy if exists sp_select_owner on public.smoking_places;
create policy sp_select_owner on public.smoking_places
  for select using (owner_user_id = auth.uid());

drop policy if exists sp_select_admin on public.smoking_places;
create policy sp_select_admin on public.smoking_places
  for select using (public.is_admin());

-- Vkládání: jen jako vlastník, jen draft/pending (nikdo se sám neschválí)
drop policy if exists sp_insert_owner on public.smoking_places;
create policy sp_insert_owner on public.smoking_places
  for insert with check (owner_user_id = auth.uid() and status in ('draft','pending'));

-- Úpravy: majitel svá (zpět do pending), admin cokoli
drop policy if exists sp_update_owner on public.smoking_places;
create policy sp_update_owner on public.smoking_places
  for update using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and status in ('draft','pending'));

drop policy if exists sp_update_admin on public.smoking_places;
create policy sp_update_admin on public.smoking_places
  for update using (public.is_admin()) with check (true);

-- Mazání: majitel svá, admin cokoli
drop policy if exists sp_delete_owner on public.smoking_places;
create policy sp_delete_owner on public.smoking_places
  for delete using (owner_user_id = auth.uid());

drop policy if exists sp_delete_admin on public.smoking_places;
create policy sp_delete_admin on public.smoking_places
  for delete using (public.is_admin());

-- 4) STORAGE: uploady fotek do bucketu place-photos --------------
-- Bucket je public pro ČTENÍ; zápis povolíme přihlášeným do složky <uid>/...
drop policy if exists pp_insert_auth on storage.objects;
create policy pp_insert_auth on storage.objects
  for insert to authenticated
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists pp_update_own on storage.objects;
create policy pp_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists pp_delete_own on storage.objects;
create policy pp_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Hotovo. Po spuštění: appka uvidí jen approved, majitelé spravují svá místa.
