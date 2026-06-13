-- ════════════════════════════════════════════════════════════════
-- CIGARIO — Events navázané na místa (venue_events)  [DRAFT k revizi]
-- Spusť AŽ po 01_business_schema.sql a 02_place_managers.sql.
-- Bezpečné spustit i opakovaně. Nesahá do appky ani marketingu.
-- ════════════════════════════════════════════════════════════════

-- 1) Tabulka -----------------------------------------------------
create table if not exists public.venue_events (
  id                uuid primary key default gen_random_uuid(),
  place_id          uuid not null references public.smoking_places(id) on delete cascade,
  created_by        uuid references auth.users(id) on delete set null,
  title             text not null,
  description       text,
  image_url         text,                       -- bucket place-photos
  starts_at         timestamptz not null,       -- datum + čas
  ends_at           timestamptz,                -- volitelný konec
  recurrence        text not null default 'none', -- none|weekly|biweekly|monthly
  recurrence_until  date,
  status            text not null default 'approved', -- AUTO-APPROVE (doporučeno). Pro pre-approval změň na 'pending'.
  lat               double precision,           -- denormalizace z místa (trigger)
  lng               double precision,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$ begin
  alter table public.venue_events add constraint venue_events_recurrence_chk
    check (recurrence in ('none','weekly','biweekly','monthly'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.venue_events add constraint venue_events_status_chk
    check (status in ('draft','pending','approved','hidden'));
exception when duplicate_object then null; end $$;

create index if not exists venue_events_place_idx       on public.venue_events(place_id);
create index if not exists venue_events_status_start_idx on public.venue_events(status, starts_at);
create index if not exists venue_events_geo_idx          on public.venue_events(lat, lng);

-- 2) Trigger: doplň lat/lng z místa ------------------------------
create or replace function public.venue_events_fill_geo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select latitude, longitude into new.lat, new.lng
    from public.smoking_places where id = new.place_id;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_venue_events_geo on public.venue_events;
create trigger trg_venue_events_geo
  before insert or update on public.venue_events
  for each row execute function public.venue_events_fill_geo();

-- 3) RLS (stejný vzor jako smoking_places) -----------------------
alter table public.venue_events enable row level security;

drop policy if exists ve_select_public on public.venue_events;
create policy ve_select_public on public.venue_events for select using (status = 'approved');

drop policy if exists ve_select_manager on public.venue_events;
create policy ve_select_manager on public.venue_events for select using (public.can_manage_smoking_place(place_id));

drop policy if exists ve_select_admin on public.venue_events;
create policy ve_select_admin on public.venue_events for select using (public.is_admin());

drop policy if exists ve_insert_manager on public.venue_events;
create policy ve_insert_manager on public.venue_events for insert
  with check (public.can_manage_smoking_place(place_id) and created_by = auth.uid());

drop policy if exists ve_update_manager on public.venue_events;
create policy ve_update_manager on public.venue_events for update
  using (public.can_manage_smoking_place(place_id))
  with check (public.can_manage_smoking_place(place_id));

drop policy if exists ve_update_admin on public.venue_events;
create policy ve_update_admin on public.venue_events for update using (public.is_admin()) with check (true);

drop policy if exists ve_delete_manager on public.venue_events;
create policy ve_delete_manager on public.venue_events for delete using (public.can_manage_smoking_place(place_id));

drop policy if exists ve_delete_admin on public.venue_events;
create policy ve_delete_admin on public.venue_events for delete using (public.is_admin());

-- 4) RPC: eventy poblíž (bounding-box, bez PostGIS) --------------
-- Vrací schválené, nadcházející (nebo opakující se) eventy v okruhu radius_km.
create or replace function public.events_near(
  in_lat double precision, in_lng double precision, radius_km double precision default 75
)
returns table (
  id uuid, place_id uuid, title text, description text, image_url text,
  starts_at timestamptz, ends_at timestamptz, recurrence text, recurrence_until date,
  lat double precision, lng double precision,
  venue_name text, venue_city text, venue_address text,
  distance_km double precision
)
language sql stable as $$
  with b as (
    select radius_km/111.0 as dlat,
           radius_km/(111.0*greatest(cos(radians(in_lat)),0.01)) as dlng
  )
  select e.id, e.place_id, e.title, e.description, e.image_url,
         e.starts_at, e.ends_at, e.recurrence, e.recurrence_until,
         e.lat, e.lng, p.name, p.city, p.address,
         111.0*sqrt(power(e.lat-in_lat,2)+power((e.lng-in_lng)*cos(radians(in_lat)),2)) as distance_km
  from public.venue_events e
  join public.smoking_places p on p.id = e.place_id
  cross join b
  where e.status = 'approved'
    and (e.recurrence <> 'none' or coalesce(e.ends_at, e.starts_at) >= now())
    and e.lat between in_lat - b.dlat and in_lat + b.dlat
    and e.lng between in_lng - b.dlng and in_lng + b.dlng
  order by e.starts_at asc
  limit 200;
$$;
grant execute on function public.events_near(double precision, double precision, double precision) to anon, authenticated;

-- Pozn.: „nejbližší výskyt" opakujících se eventů dopočítá klient z starts_at+recurrence.
-- status default = 'approved' (auto-approve). Pro pre-approval workflow přepni default na 'pending'
-- a ve_select_public nech jen approved (už je tak).
