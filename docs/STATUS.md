# Project status

Handoff file for new agents. Last updated: 2026-09-24, after Phase 5. Product owner: Ritwik. App: [http://localhost:3000](http://localhost:3000).

**Current phase: 5 complete.** Next: only if asked (time-of-day, PostGIS). Do not start further work until asked.

Original vision chat: [BayPass living map](82e6b702-9625-4c3b-bd5c-cb12c0e17b5e). Cursor plan file for Phase 1 exists but must not be edited; this file is the living plan.

## Product

Three map ideas, not a geographic radius:

1. Distance rings from SJSU (10 / 25 / 50 mi) — shipped in Phase 3. Rings are miles, not a fare boundary.
2. Transit coverage from GTFS, styled by BayPass rules — shipped in Phases 1–3.
3. Reachable-area isochrones — shipped in Phase 5. Weekday 8:00 a.m. from campus, not a time slider.

SJSU is the origin (`37.3352, -121.8811`). Santa Cruz is close but costs extra. San Francisco is farther but covered. Curated destination pins now include morning travel times on covered transit.

Official coverage: 24 Clipper agencies on SJSU’s BayPass list (VTA, BART, Caltrain, AC Transit, SamTrans, Muni without cable cars, ferries, SMART, etc.). Highway 17 Express stays outside coverage.

## Phases

| Phase | Status | What it is |
| --- | --- | --- |
| 1 | Done | Caltrain-only explorer: SJSU, Gilroy–SF, click a line, “covered by BayPass” |
| 2 | Done | All 24 covered agencies, mode/agency toggles, zoom LOD, hub labels |
| 3 | Done | Highway 17 extra fare, covered vs unpaid styling, distance rings, connected-from-SJ filter, empty-map gap copy |
| 4 | Done | Curated destination pins (16 SJSU trips), category chips, how-you-get-there copy, transit directions link |
| 5 | Done | Travel-time isochrones from SJSU (file-based CSA, not Docker OTP). Duration chips, translucent fill, faded out-of-range covered lines. Time-of-day picker later. |
| Later | Only if needed | PostGIS / vector tiles if `network.geojson` gets too large (~2MB / 597 routes now is fine); time-of-day |

## What is running now

- Full-screen MapLibre map, client-only via `src/components/MapApp.tsx`.
- Default view: zoom 10.5 at SJSU. VTA, Caltrain, BART, and Highway 17 Express on. Rail / light rail / ferry on; **Bus off** until the user enables it. Buses `minzoom` 13.
- **From campus duration** defaults to **1 hr** (`30 min` / `1 hr` / `2 hr` / `3 hr` / `Anywhere`). Fixed departure: weekday 8:00 a.m. Blue fill is covered-morning reach, not Highway 17. `Anywhere` hides the fill and turns fade off.
- **Connected from San José** on by default: only routes whose shape (or VTA, or extra-fare stops) come within ~0.03° of SJSU, Diridon, or Berryessa. This is why Livermore/Wheels disappears until the box is unchecked.
- **Distance rings** on by default.
- **Destination pins** on by default: 16 curated trips in `data/destinations.json` (gold = covered, amber = extra fare). Category chips + “Trips from campus” list. Extra-fare trips sort first in the list. Tap a pin or a trip → bottom sheet with covered vs extra-fare path, miles from SJSU, haversine walk from the named stop, Google Maps transit directions, and morning minutes when the CSA reached the pin. Fly-to uses `essential: true`.
- Solid agency-colored line = covered. Dashed amber = extra fare (never faded by the time chips). Covered lines/stops/gold pins fade when `reachMin` is beyond the selected duration. Click empty map → nearest stop + optional Highway 17 hint south of San José.
- Coverage config `data/coverage.json` **version 3**: 24 covered agencies + `highway_17` (`covered: false`, exception `highway_17_express`, `gtfsIds: ["CR"]`, `gtfsUrl` for Santa Cruz METRO). Destination `covered` flags are authored against those agencies, never inferred from GTFS fares.

Importer writes `data/generated/network.geojson` (~597 routes, ~235 stations). One longest simplified shape per `route_id` (max 80 points). Uncovered agencies import **only** named exceptions.

`npm run build:isochrones` writes `data/generated/isochrones.geojson` (4 MultiPolygons: 30 / 60 / 120 / 180) and `data/generated/reach.json` (route min/max, stop minutes, destination minutes). Served at `/api/isochrones` and `/api/reach`. Needs GTFS already in `data/cache/` from `import:gtfs`.

Sample destination minutes (weekday 8:00 a.m., covered graph): Diridon 23, downtown SJ 15, Berryessa 30, Levi’s 56, Mountain View 66, Palo Alto 74, Gilroy 82, Oakland 91, Stanford 93, Berkeley 103, San Francisco 109, SFO 115, Oracle Park 120, Sausalito 175. Golden Gate and Santa Cruz are `null` (extra fare or last-mile the router does not model).

## Key decisions

- **Coverage is app config, never GTFS fares.** Join `gtfsIds` (and optional `gtfsUrl`) in `coverage.json`.
- **511 operator feeds, not regional `RG`.** `CT` Caltrain, `SC` VTA, `BA` BART, … `CR` is listed by 511 but `datafeeds` 404s — Highway 17 uses `https://developer.scmetro.org/gtfs.zip`.
- **Caltrain 511 alias `1000` is skipped** on download; `CT` is enough.
- **Inverted exceptions:** covered + `cable_car` → skip those routes. Uncovered + `highway_17_express` → import only that route.
- **File-based GeoJSON** until size forces PostGIS.
- **MapLibre 6 + Next 16 Turbopack:** copy worker + shared modules to `public/maplibre/` (`postinstall` / `scripts/copy-maplibre-worker.mjs`), `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`. Named import `Map as MapLibreMap`.
- **Map filters must stay all-legacy:** `["in", "agencyKey", …]`, `["==", "mode", "rail"]`. Mixing `["get", …]` expressions with `in` broke agency toggles (BART would not hide). Isochrone **paint** fade may use `["get", "reachMin"]` expressions; do not put those in layer filters.
- **Filterable GeoJSON properties are strings:** `fare: "covered" | "extra"`, `connectedFromSj: "yes" | "no"`, isochrone `minutes: "30" | "60" | "120" | "180"`. Booleans from MapLibre query results are unreliable; coerce with `asBool`.
- **Hub labels are global**, not per-agency, or Berryessa/Diridon duplicate.
- **Muni stations:** if more than 80 `location_type=1` parents, keep hub- or station-named only.
- **UTF-8 BOM** on 511 zips must be stripped before `PK` zip magic.
- **Do not default-enable Bus.** Opening VTA’s full bus grid at zoom 10.5 is spaghetti.
- **Destinations are a curated catalog**, not a geocoder. `covered` / `agencyKeys` in `destinations.json` must name keys from `coverage.json`.
- **Destination layers are queried before routes/stops** so a gold pin wins over a station dot.
- **Walking distance is haversine** to the authored nearby stop, not a pedestrian router. Skip walk miles when there is no mapped stop (Golden Gate Bridge / Muni buses).
- **Isochrones are CSA on cached GTFS, not Docker OTP / OpenTripPlanner.** Covered rail, light rail, and ferry plus **VTA buses only**. Highway 17 and cable cars are out of the graph. Walk access 25 min from SJSU; no chained walks between stops (transfers ≤ 0.25 mi). Egress walk into the fill; destination minutes allow 25 min walk to the pin. Rebuild after GTFS refresh: `npm run build:isochrones`.
- **No time-of-day picker.** Departure is hardcoded weekday 8:00 a.m. `Anywhere` is the escape hatch.

## Layout (important files)

- `data/coverage.json` — source of truth for BayPass agencies
- `data/destinations.json` — curated trips (Phase 4)
- `scripts/import-gtfs.ts` — download, filter, emit GeoJSON
- `scripts/build-isochrones.ts` — CSA + contour → isochrones + reach index
- `src/lib/{coverage,destinations,isochrone,constants,mode,geo,types}.ts`
- `src/components/{MapApp,TransitMap,NetworkFilters,SelectionSheet}.tsx`
- `src/app/api/network/route.ts` — reads generated GeoJSON, `cache-control: no-store`
- `src/app/api/isochrones/route.ts` / `src/app/api/reach/route.ts`
- `src/lib/geo.ts` — haversine + ring geometry

## Pitfalls (do not rediscover)

- `ssr: false` is illegal in Next 16 Server Components — keep the map behind a client `MapApp`.
- MapLibre 6 has no default export.
- Blank map: worker 404 for `maplibre-gl-shared.mjs` if `public/maplibre/` was not copied.
- Agency toggle no-ops: expression filters vs legacy `in`.
- Extra-fare hit lines with `line-opacity: 0` were not queryable; use ~0.01 and include `routes-extra` in interactive layers.
- Browser-tool click coordinates often do not match the screenshot; prefer UI refs (checkboxes / trip list) over clicking the canvas. Overlay clicks on the trip list can be intercepted by the bottom sheet — extra-fare trips are listed first for that reason. `flyTo({ essential: true })` so reduced-motion does not skip the camera.
- Isochrone `minutes` must stay a **string** property (`"60"`, not `60`) so the legacy `["==", "minutes", …]` filter matches.
- Do not chain walks in CSA. Early marching-squares output was hundreds of overlapping polygons (~3.6MB). Raster outline stitching keeps four MultiPolygons (~105KB). Overlapping rings can still darken the fill core.
- `AGENTS.md` Next.js marker block is managed; write project text **after** `<!-- END:nextjs-agent-rules -->`.

## STATUS vs code (trust the code)

- The GeoJSON hub labeled **Berryessa** is VTA light rail **Berryessa Station** (`37.3882, -121.8623`), not BART Berryessa/North San José. BART’s Berryessa parent is missing from `network.geojson`. The Phase 4 destination pin uses the BART station from `constants.ts` (`37.3684, -121.8747`), so the gold pin sits south of the black hub. Caltrain Diridon is also absent as a stop (global hub labels already used VTA Diridon).
- The isochrone graph is **not** all 24 agencies’ buses. Non-VTA buses are omitted so CSA stays tractable; rail/light rail/ferry from covered agencies still run. Fill is therefore a covered-morning sketch, not a door-to-door OTP isochrone.

## Remaining open work

Later, only if asked: time-of-day picker, more agencies in the CSA bus graph, PostGIS / vector tiles, shareable map URLs, a geocoder dump of destinations.

## How to update this file

When a phase ends or a decision changes:

1. Set **Current phase** and the date at the top.
2. Move the shipped work into the phase table / “What is running now”.
3. Append durable decisions and new pitfalls (one line each).
4. Rewrite **Remaining open work** so a cold agent knows the next concrete step.
5. Do not paste API keys, `.env` values, or cache paths with secrets.
