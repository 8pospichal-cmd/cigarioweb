-- ════════════════════════════════════════════════════════════════
-- CIGARIO BUSINESS — managers / ownership transfer support
-- Spusť CELÉ v Supabase → SQL Editor. Bezpečné spustit opakovaně.
-- ════════════════════════════════════════════════════════════════

-- 1) Managers -----------------------------------------------------
-- Jedno místo může mít více správců. E-mail stačí i před tím, než
-- daný člověk poprvé použije magic link; RLS ho pustí podle e-mailu.
create table if not exists public.smoking_place_managers (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.smoking_places(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'manager',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

do $$ begin
  alter table public.smoking_place_managers
    add constraint smoking_place_managers_role_chk
    check (role in ('owner','manager'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.smoking_place_managers
    add constraint smoking_place_managers_status_chk
    check (status in ('active','invited','revoked'));
exception when duplicate_object then null; end $$;

create index if not exists spm_place_idx on public.smoking_place_managers(place_id);
create index if not exists spm_user_idx on public.smoking_place_managers(user_id);
create index if not exists spm_email_idx on public.smoking_place_managers(lower(email));

create unique index if not exists spm_place_email_active_uidx
  on public.smoking_place_managers(place_id, lower(email))
  where status <> 'revoked';

alter table public.smoking_place_managers enable row level security;

drop policy if exists spm_select_admin on public.smoking_place_managers;
create policy spm_select_admin on public.smoking_place_managers
  for select using (public.is_admin());

drop policy if exists spm_select_self on public.smoking_place_managers;
create policy spm_select_self on public.smoking_place_managers
  for select using (
    status <> 'revoked'
    and (
      user_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt()->>'email',''))
    )
  );

drop policy if exists spm_insert_admin on public.smoking_place_managers;
create policy spm_insert_admin on public.smoking_place_managers
  for insert with check (public.is_admin());

drop policy if exists spm_update_admin on public.smoking_place_managers;
create policy spm_update_admin on public.smoking_place_managers
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists spm_delete_admin on public.smoking_place_managers;
create policy spm_delete_admin on public.smoking_place_managers
  for delete using (public.is_admin());

-- 2) Owner access helpers ----------------------------------------
create or replace function public.can_manage_smoking_place(place uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.smoking_places p
    where p.id = place
      and p.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.smoking_place_managers m
    where m.place_id = place
      and m.status <> 'revoked'
      and (
        m.user_id = auth.uid()
        or lower(m.email) = lower(coalesce(auth.jwt()->>'email',''))
      )
  );
$$;

grant execute on function public.can_manage_smoking_place(uuid) to authenticated;

-- Majitel/manager vidí svoje místa přes RPC bez klientského skládání dotazů.
create or replace function public.get_my_business_places()
returns setof public.smoking_places
language sql stable security definer set search_path = public as $$
  select distinct p.*
  from public.smoking_places p
  left join public.smoking_place_managers m
    on m.place_id = p.id
   and m.status <> 'revoked'
  where p.owner_user_id = auth.uid()
     or m.user_id = auth.uid()
     or lower(m.email) = lower(coalesce(auth.jwt()->>'email',''))
  order by p.submitted_at desc nulls last;
$$;

grant execute on function public.get_my_business_places() to authenticated;

-- 3) RLS additions on smoking_places -----------------------------
drop policy if exists sp_select_manager on public.smoking_places;
create policy sp_select_manager on public.smoking_places
  for select using (public.can_manage_smoking_place(id));

drop policy if exists sp_update_manager on public.smoking_places;
create policy sp_update_manager on public.smoking_places
  for update using (public.can_manage_smoking_place(id))
  with check (public.can_manage_smoking_place(id) and status in ('draft','pending'));

-- Mazání zůstává jen pro původního ownera nebo admina. Manager smí upravovat,
-- ale nemá omylem smazat schválené kurátorské místo.

-- 4) Admin RPC ----------------------------------------------------
create or replace function public.admin_assign_place_manager(
  place uuid,
  manager_email text,
  manager_role text default 'manager'
)
returns public.smoking_place_managers
language plpgsql security definer set search_path = public as $$
declare
  normalized_email text := lower(trim(manager_email));
  found_user_id uuid;
  row_out public.smoking_place_managers;
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if normalized_email = '' or normalized_email is null then
    raise exception 'Email is required';
  end if;
  if manager_role not in ('owner','manager') then
    raise exception 'Invalid manager role';
  end if;
  if not exists (select 1 from public.smoking_places p where p.id = place) then
    raise exception 'Place not found';
  end if;

  select u.id into found_user_id
  from auth.users u
  where lower(u.email) = normalized_email
  limit 1;

  insert into public.smoking_place_managers (place_id, user_id, email, role, status, created_by, revoked_at)
  values (place, found_user_id, normalized_email, manager_role, case when found_user_id is null then 'invited' else 'active' end, auth.uid(), null)
  on conflict (place_id, lower(email)) where status <> 'revoked'
  do update set
    user_id = coalesce(excluded.user_id, public.smoking_place_managers.user_id),
    role = excluded.role,
    status = case when coalesce(excluded.user_id, public.smoking_place_managers.user_id) is null then 'invited' else 'active' end,
    revoked_at = null
  returning * into row_out;

  return row_out;
end;
$$;

grant execute on function public.admin_assign_place_manager(uuid,text,text) to authenticated;

create or replace function public.admin_remove_place_manager(manager_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  update public.smoking_place_managers
  set status = 'revoked', revoked_at = now()
  where id = manager_id;
end;
$$;

grant execute on function public.admin_remove_place_manager(uuid) to authenticated;

-- Hotovo:
-- - admin může přiřadit e-mail ke konkrétnímu místu,
-- - daný e-mail po magic-link přihlášení místo uvidí v owner portálu,
-- - appka dál veřejně vidí pouze approved místa.
