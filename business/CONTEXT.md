# Cigario Business — kontext pro pokračování (handoff pro Codex)

## 🎯 Cíl
Webový portál **„Cigario Business"**, kde si **majitelé podniků** (loungů, doutníkových míst, klubů…)
sami spravují své místo (detaily, fotky, otevírací doba). Po **schválení adminem** se místo
**propíše do mobilní appky Cigario** (Android + iOS) na mapu. Admin = jen Daniel.
Do budoucna (MIMO rozsah teď): eventy, analytika, platby.

## 📁 Kde pracujeme
- **Web portál (tady stavíme):** `/Users/danielpospichal/Desktop/cigario-web`
  - Statická stránka: **čisté HTML + CSS + vanilla JS, ŽÁDNÝ build, žádné npm.** Hostováno na **Netlify** (drag-drop deploy, URL `https://cigarioapp.netlify.app`).
  - Nová sekce portálu je ve složce **`/business/`**.
- **Mobilní appka (jen 1 drobná změna):** `/Users/danielpospichal/Desktop/Cigario` (Expo React Native + TS).
  - Pozn.: práce může probíhat v git worktree, ale reálné soubory appky jsou v této cestě.
- **Backend:** Supabase, projekt `https://uzdyydevxlzuvdreiprw.supabase.co` — **stejný** pro web i appku.

## ✅ Co je hotové (co jsem právě udělal)
Postaven celý MVP portálu:
- **Owner portál** `/business/`:
  - `index.html` — UI (login, dashboard „My venues", formulář místa). **Vše v ANGLIČTINĚ.**
  - `business.js` — logika: magic-link auth, výpis vlastních míst, formulář (název, typ, město, adresa,
    **mapový pin** Leaflet + **geokódování** Nominatim, **otevírací doba** = rolovací `<select>` od/do po 30 min
    + tlačítko „Sync Monday to all" + „Closed", **3 otázky** spojené do popisu, **4 povinné foto-sloty**
    upload do `place-photos`, **povinný checkbox** „smoking is permitted"), uložení/úprava/smazání.
  - `business.css` — **glass/Apple design** (blur hlavička, skleněné karty, decentní tmavé pozadí, zlatá jen akcent).
- **Admin moderace** `/business/admin/`:
  - `index.html` + `admin/admin.js` — fronta `pending`/`approved`/`hidden`, akce **Approve / Hide / Back to queue / Delete**.
    Gate přes `sb.rpc('is_admin')`.
- **Supabase klient** `/business/config.js` — `window.sb = createClient(URL, ANON_KEY)`. **Anon klíč je veřejný (OK).**
- **DB migrace** `/business/sql/01_business_schema.sql` (uživatel ji spouští ručně v Supabase).
- **Mobilní appka:** `src/firebase/firestore.ts` → `getSmokingPlaces` má nově `.eq('status','approved')` (TS 0 chyb).
- **Marketing web:** přidán jen diskrétní odkaz na `/business/` do patičky (EN i CS). Jinak NEDOTČEN.

### Ověřeno automaticky
- anon čte `approved` místa (appka se nerozbila), anon `INSERT` do `smoking_places` je odmítnut RLS (kód `42501`). ✅
- JS soubory: `node --check` OK. App: `tsc --noEmit` 0 chyb.

### NEověřeno (vyžaduje interaktivně uživatele — viz „Co dál")
Login majitelem v prohlížeči, vytvoření místa → pending, schválení v adminu → approved, zobrazení v appce, RLS test cizím účtem.
(Uživatel už potvrdil, že **login funguje** a **místo jde vytvořit**.)

## 🔌 Jak je to napojené
- **Web ↔ Supabase:** přes `@supabase/supabase-js@2` z CDN (`window.sb` v `config.js`).
  - **Auth:** magic link — `sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin + '/business/' } })`.
    Bez hesla. Session se drží (`persistSession`, `detectSessionInUrl`).
  - **Data:** `sb.from('smoking_places')` CRUD; **bezpečnost řeší RLS** (ne klient).
  - **Storage:** upload fotek `sb.storage.from('place-photos').upload('<uid>/...jpg')`, public URL přes `getPublicUrl`.
  - **Admin gate:** `sb.rpc('is_admin')` (SQL funkce `SECURITY DEFINER`).
- **Appka ↔ Supabase:** čte `smoking_places` (přes `getSmokingPlaces`). Díky RLS vidí **jen `approved`** → schválené místo se objeví **bez nového buildu appky**.

## 🗄️ Datový model (rozšíření tabulky `smoking_places`)
Nové sloupce (z migrace): `owner_user_id uuid`, `status text` ('draft'|'pending'|'approved'|'hidden'),
`moderation_note text`, `submitted_at`, `moderated_at`. + tabulka `admins(user_id)`, funkce `is_admin()`.
- Stávající (kurátorská) místa migrace nastaví na `status='approved'` → nezmizí z appky.
- `opening_hours` = `jsonb` `{ "monday": "HH:MM-HH:MM" | "closed", ... sunday }`.
- `gallery_urls` = `text[]` (4 fotky), `photo_url` = první z nich.
- `description` = 3 odpovědi spojené `\n\n` (na editaci se zpětně rozdělí podle `\n\n`).

## ⛔ Na co NESAHAT
- **Marketingový web:** `index.html` (root), `cs/`, `en/`, `privacy/`, `terms/`, `support/`, `delete-account/`, `style.css`.
  (Výjimka: už přidaný odkaz do patičky na `/business/` — neměň jeho okolí.)
- **Žádný build/bundler.** Portál musí zůstat statické soubory (vanilla JS + CDN), aby šel drag-drop na Netlify.
- **service_role klíč NIKDY do klientu.** Pouze anon klíč. Veškerá bezpečnost přes RLS.
- Portál a marketing web jsou **oddělené** — portál nesmí ovlivnit marketing stránku.

## ⚠️ Na co si dát pozor, ať se NEROZBIJE appka
- `smoking_places` má teď **zapnuté RLS**. Politika `sp_select_public` = *kdokoli vidí `status='approved'`*.
  **Když budeš měnit RLS/schéma, MUSÍ zůstat veřejné čtení `approved`**, jinak zmizí mapa v appce.
- Nepřepínej existující místa z `approved` (nezmizela by z appky). Nová místa od majitelů jdou jako `pending` (správně skrytá).
- `place-photos` je **public pro čtení**; uploady jsou omezené na složku `<uid>/` storage politikou. Nezužuj public read.
- `getSmokingPlaces` filtr `status='approved'` se v appce projeví až **při příštím buildu**; do té doby to drží RLS (propsání funguje i bez buildu).
- Nesouvisí s portálem, ale pozor: v repu appky běží i **push notifikace** (Edge Function `send-push`, build v18) — to je jiný workstream, neřeš ho tady.

## 🔐 Jak funguje přihlašování (stav)
- **Magic link** přes Supabase Auth. Uživatel zadá e-mail → přijde odkaz → klik → přihlášen. **Funguje** (ověřeno uživatelem).
- **Admin práva:** `is_admin()` čte tabulku `admins`. Admina přidáváme **podle e-mailu** (spolehlivé):
  ```sql
  insert into public.admins (user_id)
  select id from auth.users where email = 'TVUJ@EMAIL.cz' on conflict do nothing;
  ```
- **Důležité ruční nastavení v Supabase:** *Authentication → URL Configuration → Redirect URLs* musí obsahovat:
  `http://localhost:8765/business/`, `http://localhost:8765/business/admin/`, a po nasazení i netlify varianty
  `https://cigarioapp.netlify.app/business/` (+ `/admin/`). Bez toho magic link odmítne přesměrovat.

## 📋 Co je potřeba udělat dál (TODO)
1. **(uživatel) Spustit SQL** `business/sql/01_business_schema.sql` v Supabase (pokud ještě neběželo) — volit **„Run and enable RLS"**.
2. **(uživatel) Admin podle e-mailu** (SQL výše) + **Redirect URLs** v Auth.
3. **End-to-end test (body 1–5 „Hotovo"):** login → vytvoř místo se 4 fotkami + pinem → `pending` →
   v `/business/admin/` schval → `approved` → zkontroluj v mobilní appce na mapě → ověř, že cizí účet nevidí/needituje cizí místo.
4. **(uživatel) Deploy** celé složky `cigario-web` na Netlify (s `/business/`).
5. **Produkční doladění (později):** vlastní SMTP pro magic-link maily (Resend) kvůli limitům/spamu; případně proxy pro Nominatim při rate-limitu.
6. **Mimo rozsah teď (budoucnost):** eventy (majitel vytváří → geo + push), analytika pro majitele, „claim listing", multi-venue, monetizace (featured/predplatné).

## 🧪 Jak lokálně spustit/testovat
```bash
cd ~/Desktop/cigario-web && python3 -m http.server 8765
# pak: http://localhost:8765/business/  (a /business/admin/)
```
JS kontrola: `node --check business/business.js`. App TS: v repu appky `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.
