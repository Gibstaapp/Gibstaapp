# Gibstaapp

One app, two modes, picked with the switch at the top:

- **🌿 Weed:** the cheapest out-the-door cannabis prices around San Diego. Deals, first-time / veteran / senior / student
  discounts, CA + city taxes, and Weedmaps / Eaze / store delivery fees are all counted in. Ranked by $/g ($/100mg THC for edibles).
- **🍺 Beer:** where to get a beer near you right now. It works wherever you are, not just San Diego:
  - Places (bars, breweries, liquor stores) come from **OpenStreetMap**, loaded for whatever area you open the app in.
  - Happy hours and beer prices are **read from the bars' own websites**.
  - Anyone with the link can **Report a price** they saw in person.
  - Deals we confirmed ourselves go in `server/beer-seed.json` (source `"team"`, which shows a ✔ Verified badge).
  - Every price shows where it came from. Nothing is made up.

Both modes have a **🧭 Compass** that points at the place you picked, plus list and map views.

> The Padres game-day promo from the prototype was dropped: there's no reliable online source for it.
> It can come back as a hand-entered `team` deal if we confirm it with a bar.

## Run it

Needs **Node 24+** (uses the built-in `node:sqlite`). Works on Windows and Mac.

```bash
npm install
npx playwright install chromium   # headless browser used by some weed sources
npm start                         # builds the web app, starts the server on http://localhost:8787
```

Open http://localhost:8787.

### Settings: `server/data/config.json`

Create this file yourself. It's **gitignored**, and so is the rest of `server/data/` (database, APK). Example:

```json
{
  "sources": { "sample": false, "dutchie": true, "jane": true, "weedmaps": true, "eaze": true },
  "tunnel": false
}
```

- `passcode` (optional, off by default): add `"passcode": "something"` to require one (sent as the `x-gib-pass` header). The shared link currently has no passcode.
- `sources`: which weed data sources to run. Use `"sample": true` with the others `false` for fake test stores (fast, no scraping).
- `tunnel`: `true` makes a public https link (see below). Developers usually want `false`.
- Optional: `port` (default 8787), `linkTopic` (private ntfy topic the Android app reads to find the current link).

### Commands

| Command | What it does |
|---|---|
| `npm start` | Build web + run server |
| `npm run dev` | Hot-reload dev mode (web on :5173, API on :8787) |
| `npm test` | Server tests (pricing, parsers, beer ranking) |
| `npm run refresh` | Weed data refresh from the terminal, prints per-source results |
| `npm run beer -w server` | One-off beer refresh (add `-- --osm` to force re-downloading places) |
| `npm run apk` | Build the Android APK → served at `/download` |
| `npm run autostart` | Start the server automatically at Windows login |

Prices refresh when you tap ↻ (at most once every 30 min) and automatically every morning (7 AM by default, change it in Settings).

## The permanent website (GitHub Pages)

**https://<github-owner>.github.io/Gibstaapp/** stays up when the PC is off. No passcode.

- `.github/workflows/pages.yml` runs every morning (~5-6 AM San Diego): it scrapes fresh weed prices and beer data on GitHub's servers (`server/src/export-static.ts`), builds the site with `VITE_STATIC=1`, and publishes it.
- **Every push to `main` republishes the site in ~2 minutes** with the latest data, so merged changes go live automatically.
- Actions tab → "Website" → **Run workflow** refreshes prices on demand.
- In static mode there's no server: `web/src/staticApi.ts` does the pricing in the browser (same engine as the server), beer places for new areas come straight from OpenStreetMap, and settings / visited stores / price reports are saved on each phone. If a source fails one morning, yesterday's data for it is kept.
- Not available there (PC version only): shared price reports, the refresh button, ntfy morning notifications.

## The public link (PC version)

With `"tunnel": true`, the server starts a **Cloudflare quick tunnel**. Put `cloudflared` at `tools/cloudflared.exe` (the `tools/` folder is gitignored, so download it yourself).
You get a random `https://….trycloudflare.com` address that works from any phone, on Wi-Fi or data.

- The address **changes whenever the tunnel restarts**, for example when the PC reboots. The current one is in Settings → Share with friends.
- If an ntfy topic is set, the new link is pushed to you.
- Right now the live link runs on Andy's PC, so the PC has to be on and awake.

## How the compass works on the web

- The compass needs a **secure page**: the https link or `localhost`. Over plain `http://192.168…` it falls back to your home ZIP and north-up.
- **Android (Chrome, or the app):** uses `deviceorientationabsolute`, which is already referenced to north.
- **iPhone (Safari):** tap **Turn on compass** once. Apple requires a tap before the page can read the compass (`webkitCompassHeading`).
- **Computer or no sensor:** the arrow is drawn with **north at the top**, so it still shows the direction.
- **Location:** live GPS via `watchPosition`, falling back to the home ZIP if location is blocked.
- **Code:** `web/src/compass/sensors.ts` (math and sensors) and `web/src/compass/Compass.tsx` (the dial).

## Data sources

**Weed** (toggled in `config.json`):
- **dutchie / jane:** menu platforms behind many dispensaries' own sites. These are the most reliable, and they also tell us whether you can order pickup on the store's own site.
- **weedmaps / eaze:** read through a headless browser for personal use. They can break when those sites change, and this is against their terms of service.
- **sample:** fake stores for testing.

If a source fails, its last good data is kept, and the ↻ status shows which source failed.

**Beer** (`server/src/beer/`):
- **`osm.ts`:** OpenStreetMap places within ~10–25 mi of wherever the app is opened. The first open in a new area takes ~5–30 s, and areas refresh weekly.
- **`websites.ts` + `extract.ts`:** reads each bar's homepage plus up to 3 likely pages (happy hour / specials / menu) and pulls out times, days and beer prices.
  - It deliberately skips anything it isn't sure about: wine, soda, food, pitchers, "$2 off".
  - The original text is shown as fine print with a source link.
- **User reports:** the "Report a price" button. These are stored on the server and labeled "Reported N days ago".
- **`server/beer-seed.json`:** hand-entered places and deals, committed to git. Instructions are inside the file.

Most bars don't post prices online, so a lot of places show "No price yet". That gap is the opportunity: see the roadmap.

## Taxes (weed)

- `server/src/pricing/taxes.ts` holds the per-city table: CA excise 15% + city cannabis tax + sales tax, stacked the way CDTFA specifies.
- Entries marked `verified: false` are best guesses.
- If a store's prices already include tax, set that on the **Stores** tab. It overrides auto-detection.

## Roadmap / ideas

- **iPhone app.** The website already works on iPhone through the https link (Safari → Share → **Add to Home Screen**).
  A real App Store app means adding a Capacitor iOS target, which needs a Mac + Xcode + an Apple Developer account ($99/yr).
- **Permanent link.** A named Cloudflare tunnel with our own domain (~$10/yr), instead of the random quick-tunnel URL.
- **Cloud hosting,** so the app doesn't depend on Andy's PC being on.
- **Better beer data:**
  - Partner with bars: we visit, confirm their deals, and list them as ✔ Verified (`team` source). That could be a selling point for the bars too.
  - A form where bar owners submit their own happy hours and prices.
  - Untappd for Business menus (many breweries publish live tap lists with prices).
  - Google Places for opening hours (needs an API key). Only ~15% of OSM places have hours.

## Repo layout

```
shared/        TypeScript types used by server + web (types.ts, beer.ts)
server/        Fastify API, SQLite (node:sqlite), weed sources, pricing engine, beer pipeline
web/           React + Vite + Tailwind app; web/android = Capacitor Android project
scripts/       build-apk.ps1, start-server.ps1, install-autostart.ps1 (Windows)
BeerFinder/    Original beer prototype (Kotlin Android + Python FastAPI), kept for reference.
               Its compass math was ported to web/src/compass/sensors.ts.
```

Working on this together? See [CONTRIBUTING.md](CONTRIBUTING.md).
