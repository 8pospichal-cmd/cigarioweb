# Cigario — Events pro majitele (návrh + postup)

## Cíl
Správci míst (owner/manager) si vytváří **vlastní eventy navázané na své místo**: čas, foto, popis,
možnost **opakování**, a po vypršení event spadne do draftu a jde znovu vypsat/upravit.
V appce se uživatelům ukazují **jen eventy poblíž** (geo-filtr). Vizuálně stejný styl jako místa/mapa.

## Klíčová myšlenka (drží to celé jednoduché)
**Event patří k místu (`place_id`).** Tím:
- **Geo zdarma a přesně** — event zdědí GPS svého místa, takže „eventy poblíž" = vzdálenost od místa.
- **Oprávnění zdarma** — kdo smí přidat/upravit event = `can_manage_smoking_place(place_id)` (už existuje).
- **Lokace/název/web** se dají brát z místa (méně psaní pro majitele).

## Datový model — nová tabulka `venue_events`
| Sloupec | Typ | Pozn. |
|---|---|---|
| `id` | uuid PK | |
| `place_id` | uuid → smoking_places | povinné; místo, ke kterému event patří |
| `created_by` | uuid → auth.users | kdo založil |
| `title` | text | |
| `description` | text | |
| `image_url` | text | bucket `place-photos` (stejně jako fotky míst) |
| `starts_at` | timestamptz | datum + čas |
| `ends_at` | timestamptz null | volitelný konec |
| `recurrence` | text | `none`/`weekly`/`biweekly`/`monthly` |
| `recurrence_until` | date null | dokdy se opakuje |
| `status` | text | `draft`/`pending`/`approved`/`hidden` (jako u míst) |
| `lat`,`lng` | double | **denormalizace z místa** (trigger) kvůli rychlému geo-dotazu |
| `created_at`,`updated_at` | timestamptz | |

- `lat/lng` plní **trigger** z `smoking_places` při insertu/updatu (geo se nepočítá za běhu, dotaz je rychlý).
- Indexy: `(status, starts_at)`, `(place_id)`, `(lat,lng)`.

## Životní cyklus (opakování + vypršení)
- **Jednorázový:** po `ends_at` (nebo `starts_at`) v minulosti = „skončil". Majitel ho vidí v sekci
  **Ended** s tlačítkem **Re-run / Duplicate** → otevře kopii s novým datem (status `draft`→ znovu vypsat).
- **Opakující se:** uloží se pravidlo; appka i portál **dopočítají „nejbližší výskyt" ≥ teď** z `starts_at`+`recurrence`.
  Event zůstává `approved` a „roluje" dopředu; po `recurrence_until` skončí.
- **MVP bez cronu** — „je v minulosti / další výskyt" se počítá při čtení. (Volitelně později pg_cron, který
  doopravdy skončené jednorázové eventy překlopí na `draft` kvůli pořádku v dashboardu.)

## Moderace (doporučení)
- Event zakládá majitel **už schváleného místa** → **auto-approve** (důvěryhodné, menší tření = víc eventů).
  Admin je má v konzoli a může je kdykoli `hidden`/smazat. (Alternativa: `pending`→admin approve jako u míst —
  jednoduše přepnutelné výchozím statusem. Doporučuju auto-approve, u problémových míst dořešíme.)

## Geo-filtr „eventy poblíž" (hlavní otázka)
- Každý event má `lat/lng` (z místa). Appka zná polohu uživatele (už ji má z mapy).
- **RPC `events_near(lat, lng, radius_km)`** → join `venue_events`+`smoking_places`,
  filtr `status='approved'` + **nejbližší výskyt ≥ teď** + uvnitř radiusu, vrátí seřazené dle data/vzdálenosti.
- MVP bez PostGIS: **bounding-box** (lat/lng ± Δ) v RPC, přesná vzdálenost a řazení doladí klient.
  Pro pár tisíc eventů úplně stačí; PostGIS/earthdistance přidáme, až bude objem velký.
- Appka Events tab: **„Near you"** (default radius ~50–100 km, rozšiřitelný) + volitelně přepínač „All / By city".
  Na kartě ukázat **vzdálenost** („12 km").

## UX pro majitele (portál `/business/`, nová sekce „Events")
- V dashboardu záložka **Events**.
- **New event:** vyber **své schválené místo** (z `get_my_business_places`, jen approved) → title, description,
  **1 foto** (place-photos), **datum + čas** (reuse rolovací time-select, co už máš), volitelně end,
  **recurrence** (none/weekly/biweekly/monthly + until). Uložit.
- **Seznam** eventů seskupený: **Upcoming / Pending / Ended (drafts)**. U každého: Edit, **Duplicate/Re-run**, Delete.
- Stejné skleněné karty jako u míst.

## UX pro uživatele (appka, Events tab)
- Karty jako u míst: foto eventu, **název, místo (venue), datum/čas, vzdálenost** → tap → detail.
- Detail: popis, **odkaz na místo** (otevře place na mapě/detailu), datum/čas, indikátor opakování
  („Every Thursday"), „Add to calendar" / registrace.
- Default **Near you** (geo); prázdný stav → „No events near you — see all".
- Volitelně **piny eventů na mapě**.

## Synergie s push (silná přidaná hodnota – fáze 2)
Při schválení/publikaci eventu **push uživatelům v okolí** (do X km) nebo **sledujícím/uloživším dané místo** —
přes existující Edge Function `send-push` + webhook na `venue_events`. Zdarma cílený marketing pro podnik.

## Co reusovat / NEROZBÍT
- Reuse: `can_manage_smoking_place(place_id)`, `get_my_business_places()`, bucket `place-photos`,
  glass UI + rolovací time-select, admin moderace, `send-push`.
- **Nech existující `events` tabulku + EventsScreen funkční.** `venue_events` je **nová** tabulka.
  Appka Events tab: primárně `events_near` (venue eventy); staré globální `events` můžou zůstat jako „Featured".
- RLS: manager insert/update jen eventy svého místa (`can_manage_smoking_place(place_id)`),
  veřejnost čte `approved`+upcoming, admin vše. (Stejný vzor jako `smoking_places`.)

## Postup (fáze)
**Fáze 1 (MVP):**
1. SQL: `venue_events` + trigger na `lat/lng` z místa + RLS + indexy + RPC `events_near`. (Samostatný `.sql`, spustí Daniel.)
2. Portál: sekce **Events** (create/edit/list/duplicate) navázaná na schválená místa.
3. Appka: Events tab → **geo „Near you"** seznam + detail (přes `events_near`).

**Fáze 2:**
4. Doladění opakování + auto-roll + „Re-run" skončených.
5. **Push** do okolí/sledujícím při approve (reuse `send-push`).
6. Piny eventů na mapě, RSVP/attendees, add-to-calendar.

## Otevřené rozhodnutí (doporučení v závorce)
- Moderace eventů: **auto-approve pro schválená místa** (doporučeno) vs pending→approve.
- Default radius „Near you": **~75 km** (doporučeno), rozšiřitelný uživatelem.
