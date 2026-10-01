<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BayPass map

Living transit territory map for SJSU Clipper BayPass. Start at campus, zoom outward, and see which Bay Area transit the pass opens up—agency by agency, route by route, later destination by destination.

**On every new chat, read [`docs/STATUS.md`](docs/STATUS.md) before changing code.** That file is the handoff: what is built, why, and what is next. Update it at the end of a phase, after a major decision, or before the session is likely to run out of context. Do not reconstruct the project from chat transcripts if STATUS.md is current.

Leave the Next.js block above intact. `next dev` upserts it in place and preserves everything after it.

## Non-negotiables

- Coverage comes only from `data/coverage.json`. Never infer BayPass coverage from GTFS fares.
- Highway 17 Express is extra fare (dashed amber), not covered. Muni cable cars are excluded.
- Do not commit `.env.local`, `FIVE11_API_KEY`, `data/cache/`, or `public/maplibre/`.
- Do not edit `~/.cursor/plans/caltrain_map_v0_a40a98c0.plan.md`. Forward plan lives in `docs/STATUS.md`.
- Commit and push only when asked. Do not put secrets in git, STATUS.md, or rules.
- UI work is not done until the changed flow is verified in the browser (behavior, not a single screenshot).

## Stack

Next.js 16 App Router, TypeScript, Tailwind 4, MapLibre GL JS 6 (named `Map` import, no default export), OpenFreeMap Positron tiles. Network GeoJSON from `scripts/import-gtfs.ts` via `/api/network`. No PostGIS yet.

## Commands

```bash
npm run import:gtfs   # 511 + Santa Cruz METRO exception → data/generated/network.geojson
FORCE_REFRESH=1 npm run import:gtfs
npm run build:isochrones # cached GTFS → data/generated/isochrones.geojson + reach.json
npm run dev           # http://localhost:3000
```

Copy `.env.example` to `.env.local` and set `FIVE11_API_KEY`.

## After a phase

Update `docs/STATUS.md`: current phase, what shipped, decisions, pitfalls, remaining work, and the next concrete step. Then stop unless asked to start the next phase.
