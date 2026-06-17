-- ════════════════════════════════════════════════════════════════
-- CIGARIO — events_near: vrať i foto/typ/web místa (pro Event detail)
-- Spusť v Supabase → SQL Editor (po 03_venue_events.sql).
-- ════════════════════════════════════════════════════════════════

-- Měníme návratové sloupce → nutný DROP + CREATE.
drop function if exists public.events_near(double precision, double precision, double precision);

create function public.events_near(
  in_lat double precision, in_lng double precision, radius_km double precision default 75
)
returns table (
  id uuid, place_id uuid, title text, description text, image_url text,
  starts_at timestamptz, ends_at timestamptz, recurrence text, recurrence_until date,
  lat double precision, lng double precision,
  venue_name text, venue_city text, venue_address text,
  venue_type text, venue_photo_url text, venue_website_url text,
  distance_km double precision
)
language sql stable as $$
  with b as (
    select radius_km/111.0 as dlat,
           radius_km/(111.0*greatest(cos(radians(in_lat)),0.01)) as dlng
  )
  select e.id, e.place_id, e.title, e.description, e.image_url,
         e.starts_at, e.ends_at, e.recurrence, e.recurrence_until,
         e.lat, e.lng,
         p.name, p.city, p.address, p.type, p.photo_url, p.website_url,
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
