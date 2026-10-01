# BayPass map

A living transit territory map for SJSU’s Clipper BayPass. It starts at campus and shows which Bay Area transit the pass opens up: covered lines solid, extra-fare connections dashed amber, 10 / 25 / 50-mile rings from SJSU, curated trip pins, and a weekday-morning travel-time fill.

Phases 1–5 are done. The app runs locally at [http://localhost:3000](http://localhost:3000).

## Open it now

This machine already has dependencies, `.env.local`, and generated map data. From the project folder:

```bash
cd ~/Desktop/baypass
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Stop the server with Ctrl+C.

You do **not** need to re-download GTFS or rebuild isochrones unless you want a fresh feed. Those generated files are already here:

- `data/generated/network.geojson` — routes and stops
- `data/generated/isochrones.geojson` — 30 / 60 / 120 / 180 minute fills
- `data/generated/reach.json` — minutes for routes, stops, and destinations

## First-time setup

Use this on a new machine, or if `node_modules` or `data/generated/` is missing.

1. Install [Node.js](https://nodejs.org/) (this project was last run on Node 22).
2. Request a free 511 Open Data token: [511.org/open-data](https://511.org/open-data)
3. Copy `.env.example` to `.env.local` and set `FIVE11_API_KEY`. Never commit `.env.local`.
4. Install, import, build the morning reach, and start:

```bash
npm install
npm run import:gtfs
npm run build:isochrones
npm run dev
```

`npm install` copies MapLibre’s worker files into `public/maplibre/` so the map renders under Next.js / Turbopack. That folder is gitignored.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run import:gtfs` | Download 511 feeds (plus Santa Cruz METRO for Highway 17) and write `network.geojson` |
| `FORCE_REFRESH=1 npm run import:gtfs` | Ignore the zip cache and download again |
| `npm run build:isochrones` | Read the cached GTFS and write `isochrones.geojson` + `reach.json`. Run this after a GTFS refresh. |
| `npm run build` / `npm start` | Production build, then serve it |
| `npm run lint` | ESLint |

Zips are cached in `data/cache/` (gitignored). Optional: set `GTFS_ZIP` in `.env.local` to parse one local zip instead of downloading.

## What the map shows

Origin is SJSU (`37.3352, -121.8811`). Default zoom is 10.5.

**On by default:** VTA, Caltrain, BART, and Highway 17 Express. Rail, light rail, and ferry. Distance rings. Destination pins. “Connected from San José.” Duration **1 hr**.

**Off until you turn it on:** Bus. Local buses also stay hidden until you zoom in (about zoom 13), so the South Bay bus grid does not cover the opening view.

| Control | Meaning |
| --- | --- |
| 30 min / 1 hr / 2 hr / 3 hr | Blue fill: how far **covered** transit goes from campus on a weekday at 8:00 a.m. Covered lines and gold pins fade when they sit outside that time. |
| Anywhere | Hide the fill and show the full covered network at full opacity. |
| Connected from San José | Keep lines that come near SJSU, Diridon, or Berryessa. Uncheck it to see agencies that never touch San José (Livermore / Wheels, and similar). |
| Distance rings | 10 / 25 / 50 miles from SJSU. These are miles, not a fare boundary. |
| Destination pins | 16 curated trips. Gold = on BayPass. Amber = extra fare. |
| Agencies | Toggle who is drawn. “More agencies” holds the rest of the 24 covered operators. |

Click a line, a stop, a pin, or a trip in “Trips from campus.” The bottom sheet says whether the ride is covered, how you get there, miles from SJSU, and morning minutes when the router reached that pin. Extra-fare lines stay dashed amber and do not fade with the time chips.

The point of the map: Santa Cruz is closer than San Francisco in miles, but Highway 17 Express is a separate fare. San Francisco is farther and covered (about 1 hr 49 min on a weekday morning via Caltrain or BART).

Sample morning times on covered transit: downtown San José ~15 min, Diridon ~23, Berryessa ~30, Levi’s ~56, Mountain View ~66, Palo Alto ~74, Gilroy ~82, Oakland ~91, Stanford ~93, Berkeley ~103, San Francisco ~109, SFO ~115, Oracle Park ~120, Sausalito ~175. Golden Gate Bridge and Santa Cruz have no covered-morning time.

## What shipped

| Phase | What it is |
| --- | --- |
| 1 | Caltrain from Gilroy to San Francisco, click a line, “covered by BayPass” |
| 2 | All 24 covered agencies, mode and agency toggles, zoom detail, hub labels |
| 3 | Highway 17 as extra fare, covered vs unpaid styling, distance rings, connected-from-San José filter |
| 4 | 16 curated destination pins, category chips, how-you-get-there copy, Google Maps transit directions |
| 5 | Travel-time fill from campus (30 / 60 / 120 / 180 min), faded “covered but farther than this,” minutes in the trip sheet |

Not built, on purpose: a time-of-day slider, Docker / OpenTripPlanner, PostGIS, shareable map URLs, a full geocoder of every place.

## Coverage rules

BayPass coverage comes only from `data/coverage.json`. The importer does not infer the pass from GTFS fares.

- 24 covered Clipper agencies (VTA, BART, Caltrain, AC Transit, SamTrans, Muni without cable cars, ferries, SMART, and the rest of SJSU’s list).
- Highway 17 Express is shown and labeled extra fare. It is not a covered ride.
- Muni cable cars are excluded.
- The morning fill uses covered rail, light rail, and ferry, plus **VTA buses only**. Other agencies’ buses are on the map when you zoom in, but they are not in the travel-time graph. Treat the blue fill as a covered-morning sketch, not door-to-door routing.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind 4, MapLibre GL JS 6, OpenFreeMap Positron tiles. No database. Routes are GeoJSON files read by `/api/network`, `/api/isochrones`, and `/api/reach`.

## Where things live

- `data/coverage.json` — which agencies BayPass covers
- `data/destinations.json` — the 16 curated trips
- `scripts/import-gtfs.ts` — download and filter GTFS
- `scripts/build-isochrones.ts` — morning reach from cached GTFS
- `src/components/` — map, filters, bottom sheet
- `docs/STATUS.md` — handoff for the next coding session (decisions, pitfalls, what not to rebuild)

## Git

Source: [github.com/SpAcY001/Baypass](https://github.com/SpAcY001/Baypass)

The app still runs on your machine with `npm run dev`. This repository does not deploy a public website. Do not commit `.env.local`, `data/cache/`, or `public/maplibre/`.

Transit data © 511 SF Bay. Map © OpenFreeMap / OpenStreetMap contributors.
