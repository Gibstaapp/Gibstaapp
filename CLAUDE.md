# Gibstaapp: notes for Claude Code

Two developers each work with their own Claude Code on this repo. Use a branch + PR per change (see CONTRIBUTING.md). Never push straight to `main` unless asked.

## What it is
- One web app (plus an Android wrapper) with a 🌿 Weed / 🍺 Beer switch at the top.
- **Weed:** cheapest out-the-door cannabis around San Diego (deals, taxes, delivery).
- **Beer:** bars, breweries and liquor stores near wherever the user is, with happy hours and prices.
- Both modes have a compass that points to the chosen place.

## Architecture
- **npm workspaces:** `shared/` (types), `server/` (Fastify + `node:sqlite`, Node 24+), `web/` (React + Vite + Tailwind, react-leaflet).
- **Android:** a Capacitor wrapper in `web/android`. An iPhone app is a future consideration; nothing iOS exists yet.
- **Server data:** lives in `server/data/` (gitignored): `config.json` (passcode, sources, tunnel), `gibstaapp.db`, the APK.
- **Auth:** every `/api/*` call except `/api/auth` needs the `x-gib-pass` header when a passcode is set.
- **Refresh:** `POST /api/refresh` and `POST /api/beer/refresh` are throttled to once per 30 min. A 7 AM cron runs both (`server/src/scheduler.ts`).
- **Public link:** `server/src/tunnel.ts` runs a Cloudflare quick tunnel (`tools/cloudflared.exe`). The URL is random and changes on restart.

## Key files
- **Weed pricing:** `server/src/pricing/{engine,deals,taxes}.ts`
  - Sources: `server/src/sources/*.ts` (dutchie, jane, weedmaps, eaze, sample)
  - Merge/cleanup: `normalize.ts`, `sanitize.ts`, `refresh.ts`
- **Beer:** `server/src/beer/`
  - `osm.ts`: OpenStreetMap places for a bbox around a point.
  - `extract.ts`: happy-hour/price text parsing.
  - `websites.ts`: light crawl of bar sites.
  - `hours.ts`: opening_hours, time windows, bearing.
  - `rank.ts`: what applies now, $/pint ranking.
  - `refresh.ts`: per-area loading via `ensureArea`, weekly refresh, `beer-seed.json`.
- **Hand-entered beer deals:** `server/beer-seed.json` (source `team` = Verified).
- **Web:**
  - Shell and mode switch: `web/src/App.tsx`.
  - Pages: `pages/DealsPage.tsx` (weed), `pages/BeerPage.tsx` (beer compass/list/map, detail sheet, report form).
  - Compass: `web/src/compass/{sensors.ts,Compass.tsx}`, `components/WeedCompass.tsx`.
  - API client: `web/src/api.ts`.
  - Shared look for both sides (cards, filter bar, open badge, logo, accent colors): `components/Place.tsx`. Weed = green, beer = amber. Build new UI from these so the two sides stay identical.
  - Compass closeness indicator (burn mark / sloshing beer): `compass/Heat.tsx`, animations in `index.css`.
  - Badges: rules in `shared/badges.ts`, phone storage in `web/src/badges.ts`, `pages/BadgesPage.tsx`, `components/BadgeParty.tsx`.
- **Regions / area codes:** `shared/areas.ts` (U.S. = San Diego, Europe = Athens: currency, units, weedLegal, time zone), Athens list in `shared/athens-postcodes.ts` (generated from OpenStreetMap, see `scripts/athens-postcodes/`). Web gets the region from `web/src/region.ts` (`useRegion`). Never hard-code `$` or `mi` in new UI: use `fmtDistance` / `CURRENCY_SYMBOL`.
- **Launch cities** in the daily beer data: `LAUNCH_AREAS` in `server/src/beer/refresh.ts`.
- **PDF menus (both cities):** `server/src/beer/pdf.ts`. The website step also reads PDFs a bar links that are named like menus (never press clippings, grant posters or menus over 24 months old): text PDFs are rebuilt row by row; picture-only PDFs get OCR (tesseract.js, English for San Diego, Greek + English for Athens, max 30 pages a run). Each price keeps the menu's date (`menuDate`, shown as "dated May 2025"). A bar whose PDF fails to download keeps its previous prices.
- **Manual refresh per city:** GitHub Actions → Website → Run workflow → city (both / san-diego / athens); the app's beer refresh button (PC version) refreshes the city you're looking at; `npm run beer:athens -w server` / `npm run beer:sandiego -w server`.
- **Two separate daily beer refreshes:** San Diego (`refreshBeer({ region: 'us' })`, dollars, status lines `osm` + `bar-websites`) and Athens (`region: 'europe'`, euros, `athens-places` + `athens-menus`). Each at 7 AM local time on the PC (`scheduler.ts`); on GitHub the morning run does both and a separate 7 AM Athens run uses `REFRESH=athens`. One city's refresh never touches the other's data or status (`mergeBeerStatus`). `npm run beer -w server -- --region europe` runs one.
- **Opening hours (both sides):** `server/src/hours.ts` (open now, closing soon, Weedmaps hours -> opening_hours text, time zones).
- **Shared types:** `shared/types.ts`, `shared/beer.ts`, `shared/badges.ts`.
- **Prototype:** `BeerFinder/` is the original Kotlin + Python beer prototype, kept for reference only. Not built or run.

## Two ways it runs
- **PC server** (npm start: Fastify API + cloudflared quick-tunnel link).
- **GitHub Pages static site** (VITE_STATIC=1 build; web/src/staticApi.ts implements the same api surface in the browser; data comes from server/src/export-static.ts run by .github/workflows/pages.yml). Any API change must be mirrored in staticApi.ts. Server pricing/beer modules imported by the web must stay browser-safe (no node: imports).

## Commands
- `npm test`: server vitest suite (must stay green).
- `npx tsc -p server --noEmit` and `npx tsc -p web --noEmit`: typechecks.
- `npm run dev`: hot reload. `npm start`: build web + run server on :8787.
- `npm run beer -w server`: one-off beer refresh. `npm run refresh`: weed refresh.

## Conventions and gotchas
- **Data honesty:** only show prices that came from a real source (website, user report, team-verified seed). Always label the source and keep the original snippet as fine print. Never invent or "example" beer deals in live data.
- **Windows Git Bash:** `sed`, heredocs and `node -e` one-liners mangle regex `\b` (it becomes a backspace) and backticks / `${}`. Edit regex-heavy or template-literal code with the Edit tool.
- **Times:** the server runs in Pacific time. Beer queries send `tzOffset`, so open/closed and happy hours use the phone's local time.
  Weed store hours are always judged on San Diego time (`wallClockIn`). Tests pin the time zone in `server/vitest.config.ts`.
- **Athens prices** go in `server/beer-seed.json` only from the bar's own menu (website or its Untappd menu), with `currency: 'EUR'`, `url`, `date` and the original text as `note`. Never from blogs or reviews. A separate daily step, `refreshAthensMenus` (status "Athens bar menus (€)", `npm run athens -w server`), reads Athens bars' own websites with `parseEuroPrices`; Untappd is never read automatically.
- **100-mile rule:** nothing farther than `MAX_RESULT_MILES` (100) from the home area code is ever shown, weed or beer. Prices must be in the place's own currency (`regionAt`), so Athens is always €.
- **Beer price parsing** is strict on purpose (`server/test/accuracy.test.ts` holds real snippets that used to produce wrong prices). Add the snippet as a test when you find a new bad one.
- **Weed sources** (Weedmaps/Eaze) scrape with Playwright and are fragile. A failed source keeps its previous data.
- Don't commit anything under `server/data/`, `tools/`, APKs or logs.
