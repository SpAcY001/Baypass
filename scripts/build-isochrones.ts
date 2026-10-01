import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { SJSU } from "../src/lib/constants";
import {
  agencyEntries,
  coverageForAgencyId,
  type CoverageAgency,
} from "../src/lib/coverage";
import { destinations } from "../src/lib/destinations";
import { haversineMiles } from "../src/lib/geo";
import {
  ISOCHRONE_CUTOFFS,
  ISOCHRONE_DEPARTURE_LABEL,
  reachKey,
  type IsochroneCutoff,
  type ReachIndex,
} from "../src/lib/isochrone";
import { isCableCar, modeFromRouteType } from "../src/lib/mode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "data/cache");
const ISOCHRONE_PATH = join(ROOT, "data/generated/isochrones.geojson");
const REACH_PATH = join(ROOT, "data/generated/reach.json");

const WALK_M_PER_SEC = 1.3;
const MAX_ACCESS_SEC = 25 * 60;
const MAX_EGRESS_SEC = 15 * 60;
const MAX_DESTINATION_WALK_SEC = 25 * 60;
const MAX_TRANSFER_MILES = 0.25;
const TRANSFER_SLACK_SEC = 90;
const DEPART_SEC = 8 * 3600;
const HORIZON_SEC = 180 * 60 + 20 * 60;
const BOARD_END_SEC = DEPART_SEC + HORIZON_SEC;
const CSA_ROUNDS = 7;
const GRID_DEG = 0.0022;

type CsvRow = Record<string, string>;
type RouteRow = CsvRow & {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_type?: string;
};
type TripRow = CsvRow & { trip_id: string; route_id: string; service_id: string };
type StopRow = CsvRow & {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type?: string;
  parent_station?: string;
};
type StopTimeRow = CsvRow & {
  trip_id: string;
  arrival_time?: string;
  departure_time?: string;
  stop_id: string;
  stop_sequence: string;
};
type CalendarRow = CsvRow & {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  start_date: string;
  end_date: string;
};
type CalendarDateRow = CsvRow & {
  service_id: string;
  date: string;
  exception_type: string;
};

type StopNode = {
  id: string;
  agencyKey: string;
  stopId: string;
  name: string;
  lon: number;
  lat: number;
};

type Connection = {
  from: string;
  to: string;
  dep: number;
  arr: number;
  trip: string;
  routeKey: string;
};

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

function stripBom(buffer: Buffer): Buffer {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3);
  }
  return buffer;
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function parseCsv<T extends CsvRow>(text: string): T[] {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    trim: true,
  }) as T[];
}

function readGtfsFile(zip: AdmZip, name: string): string | null {
  const entry =
    zip.getEntry(name) ??
    zip.getEntries().find((item) => item.entryName.split("/").pop() === name);
  if (!entry) return null;
  return zip.readAsText(entry);
}

function parseGtfsTime(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2] ?? "0");
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function walkSeconds(miles: number): number {
  return (miles * 1609.344) / WALK_M_PER_SEC;
}

function formatYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseYmd(value: string): Date {
  return new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
    ),
  );
}

function dowField(date: Date): keyof CalendarRow {
  return (
    ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const
  )[date.getUTCDay()];
}

function pickServiceDate(calendars: CalendarRow[]): Date {
  const fallback = new Date(Date.UTC(2026, 8, 23));
  if (!calendars.length) return fallback;
  let minStart = calendars[0].start_date;
  let maxEnd = calendars[0].end_date;
  for (const row of calendars) {
    if (row.start_date < minStart) minStart = row.start_date;
    if (row.end_date > maxEnd) maxEnd = row.end_date;
  }
  const start = parseYmd(minStart);
  const end = parseYmd(maxEnd);
  const candidate = fallback < start ? start : fallback > end ? end : fallback;
  const day = candidate.getUTCDay();
  const shift = day === 3 ? 0 : (3 - day + 7) % 7;
  const wednesday = new Date(candidate.getTime() + shift * 86400000);
  return wednesday > end ? candidate : wednesday;
}

function activeServices(
  calendars: CalendarRow[],
  dates: CalendarDateRow[],
  date: Date,
): Set<string> {
  const ymd = formatYmd(date);
  const field = dowField(date);
  const ids = new Set<string>();
  for (const row of calendars) {
    if (row[field] === "1" && row.start_date <= ymd && ymd <= row.end_date) {
      ids.add(row.service_id);
    }
  }
  for (const row of dates) {
    if (row.date !== ymd) continue;
    if (row.exception_type === "1") ids.add(row.service_id);
    if (row.exception_type === "2") ids.delete(row.service_id);
  }
  return ids;
}

function shouldRoute(
  agency: CoverageAgency,
  operatorId: string,
  routeType: string | undefined,
  routeName: string,
): boolean {
  if (!agency.covered) return false;
  if (agency.exceptions.includes("cable_car") && isCableCar(routeType, routeName)) {
    return false;
  }
  const mode = modeFromRouteType(routeType);
  if (mode === "bus") return operatorId === "SC";
  return mode === "rail" || mode === "light_rail" || mode === "ferry";
}

function loadCachedZip(operatorId: string): Buffer | null {
  const cachePath = join(CACHE_DIR, `${operatorId}.zip`);
  if (!existsSync(cachePath)) return null;
  const buffer = stripBom(readFileSync(cachePath));
  return isZip(buffer) ? buffer : null;
}

function feedsToRoute(): { operatorId: string }[] {
  const seen = new Set<string>();
  const feeds: { operatorId: string }[] = [];
  for (const [, agency] of agencyEntries) {
    if (!agency.covered) continue;
    for (const id of agency.gtfsIds) {
      if (id === "1000" || seen.has(id)) continue;
      seen.add(id);
      feeds.push({ operatorId: id });
    }
  }
  return feeds;
}

function buildWalkGraph(stops: StopNode[]): Map<string, { id: string; walk: number }[]> {
  const buckets = new Map<string, StopNode[]>();
  const cell = 0.01;
  for (const stop of stops) {
    const key = `${Math.floor(stop.lon / cell)}:${Math.floor(stop.lat / cell)}`;
    const list = buckets.get(key) ?? [];
    list.push(stop);
    buckets.set(key, list);
  }
  const neighbors = new Map<string, { id: string; walk: number }[]>();
  for (const stop of stops) {
    const gx = Math.floor(stop.lon / cell);
    const gy = Math.floor(stop.lat / cell);
    const nearby: { id: string; walk: number }[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other.id === stop.id) continue;
          const miles = haversineMiles(stop.lon, stop.lat, other.lon, other.lat);
          if (miles > MAX_TRANSFER_MILES) continue;
          nearby.push({ id: other.id, walk: Math.round(walkSeconds(miles) + 30) });
        }
      }
    }
    neighbors.set(stop.id, nearby);
  }
  return neighbors;
}

function runCsa(
  stops: StopNode[],
  connections: Connection[],
  neighbors: Map<string, { id: string; walk: number }[]>,
): Map<string, number> {
  const arrivals = new Map<string, number>();
  const viaTrip = new Map<string, string>();
  const viaWalk = new Set<string>();

  for (const stop of stops) {
    const miles = haversineMiles(SJSU.longitude, SJSU.latitude, stop.lon, stop.lat);
    const walk = walkSeconds(miles);
    if (walk <= MAX_ACCESS_SEC) {
      arrivals.set(stop.id, DEPART_SEC + Math.round(walk));
      viaWalk.add(stop.id);
    }
  }

  const sorted = connections.slice().sort((a, b) => a.dep - b.dep || a.arr - b.arr);

  const relaxTransfers = () => {
    let changed = false;
    const seeded: [string, number][] = [];
    for (const [from, arrival] of arrivals) {
      if (viaWalk.has(from)) continue;
      seeded.push([from, arrival]);
    }
    for (const [from, arrival] of seeded) {
      const list = neighbors.get(from);
      if (!list) continue;
      for (const edge of list) {
        const next = arrival + edge.walk;
        if (next > BOARD_END_SEC) continue;
        const current = arrivals.get(edge.id) ?? Infinity;
        if (next < current) {
          arrivals.set(edge.id, next);
          viaTrip.delete(edge.id);
          viaWalk.add(edge.id);
          changed = true;
        }
      }
    }
    return changed;
  };

  for (let round = 0; round < CSA_ROUNDS; round += 1) {
    let improved = false;
    for (const connection of sorted) {
      const fromArr = arrivals.get(connection.from);
      if (fromArr == null) continue;
      const slack = viaTrip.get(connection.from) === connection.trip ? 0 : TRANSFER_SLACK_SEC;
      if (fromArr + slack > connection.dep) continue;
      const current = arrivals.get(connection.to) ?? Infinity;
      if (connection.arr < current) {
        arrivals.set(connection.to, connection.arr);
        viaTrip.set(connection.to, connection.trip);
        viaWalk.delete(connection.to);
        improved = true;
      }
    }
    if (relaxTransfers()) improved = true;
    if (!improved) break;
  }

  return arrivals;
}

function circlesToMultiPolygon(
  circles: { lon: number; lat: number; radiusMiles: number }[],
): GeoJSON.MultiPolygon | null {
  if (!circles.length) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const circle of circles) {
    const dLat = circle.radiusMiles / 69;
    const dLon = circle.radiusMiles / (69 * Math.cos((circle.lat * Math.PI) / 180));
    minLon = Math.min(minLon, circle.lon - dLon);
    maxLon = Math.max(maxLon, circle.lon + dLon);
    minLat = Math.min(minLat, circle.lat - dLat);
    maxLat = Math.max(maxLat, circle.lat + dLat);
  }
  const pad = GRID_DEG * 2;
  minLon -= pad;
  maxLon += pad;
  minLat -= pad;
  maxLat += pad;
  const width = Math.ceil((maxLon - minLon) / GRID_DEG) + 1;
  const height = Math.ceil((maxLat - minLat) / GRID_DEG) + 1;
  const inside = new Uint8Array(width * height);

  for (const circle of circles) {
    const dLat = circle.radiusMiles / 69;
    const dLon = circle.radiusMiles / (69 * Math.cos((circle.lat * Math.PI) / 180));
    const x0 = Math.max(0, Math.floor((circle.lon - dLon - minLon) / GRID_DEG));
    const x1 = Math.min(width - 1, Math.ceil((circle.lon + dLon - minLon) / GRID_DEG));
    const y0 = Math.max(0, Math.floor((circle.lat - dLat - minLat) / GRID_DEG));
    const y1 = Math.min(height - 1, Math.ceil((circle.lat + dLat - minLat) / GRID_DEG));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const lon = minLon + x * GRID_DEG;
        const lat = minLat + y * GRID_DEG;
        if (haversineMiles(circle.lon, circle.lat, lon, lat) <= circle.radiusMiles) {
          inside[y * width + x] = 1;
        }
      }
    }
  }

  const isIn = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;

  const toLonLat = (x: number, y: number): [number, number] => [
    minLon + x * GRID_DEG,
    minLat + y * GRID_DEG,
  ];

  const vertexKey = (x: number, y: number) => `${x},${y}`;
  const edgeKey = (from: string, to: string) => `${from}>${to}`;
  const outgoing = new Map<string, string[]>();
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const from = vertexKey(x1, y1);
    const to = vertexKey(x2, y2);
    const list = outgoing.get(from) ?? [];
    list.push(to);
    outgoing.set(from, list);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isIn(x, y)) continue;
      if (!isIn(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1);
      if (!isIn(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y);
      if (!isIn(x, y - 1)) addEdge(x + 1, y, x, y);
      if (!isIn(x - 1, y)) addEdge(x, y, x, y + 1);
    }
  }

  const rings: [number, number][][] = [];
  const used = new Set<string>();
  for (const start of outgoing.keys()) {
    const firstTo = (outgoing.get(start) ?? []).find((to) => !used.has(edgeKey(start, to)));
    if (!firstTo) continue;
    const ringVerts: string[] = [start];
    let current = start;
    let next: string | null = firstTo;
    let guard = 0;
    while (next && guard < 200000) {
      guard += 1;
      used.add(edgeKey(current, next));
      ringVerts.push(next);
      if (next === start && ringVerts.length > 3) break;
      const options: string[] = outgoing.get(next) ?? [];
      const follow = options.find((candidate: string) => !used.has(edgeKey(next as string, candidate)));
      current = next;
      next = follow ?? null;
    }
    if (ringVerts.length < 5) continue;
    const ring = ringVerts.map((vertex) => {
      const [vx, vy] = vertex.split(",").map(Number);
      return toLonLat(vx, vy);
    });
    ring[ring.length - 1] = ring[0];
    if (Math.abs(ringArea(ring)) < 1e-5) continue;
    rings.push(simplifyRing(ring));
  }

  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const polygons = rings.slice(0, 16).map((ring) => [ring]);
  if (!polygons.length) return null;
  return { type: "MultiPolygon", coordinates: polygons };
}

function ringArea(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function simplifyRing(ring: [number, number][]): [number, number][] {
  if (ring.length <= 60) return ring;
  const step = Math.max(2, Math.ceil(ring.length / 180));
  const simplified: [number, number][] = [];
  for (let i = 0; i < ring.length - 1; i += step) simplified.push(ring[i]);
  simplified.push(ring[0]);
  return simplified;
}

function loadOperator(operatorId: string, serviceDate: Date | null): {
  stops: StopNode[];
  connections: Connection[];
  calendars: CalendarRow[];
} {
  const buffer = loadCachedZip(operatorId);
  if (!buffer) {
    console.warn(`  ${operatorId}: no cached zip`);
    return { stops: [], connections: [], calendars: [] };
  }
  const zip = new AdmZip(buffer);
  const routesText = readGtfsFile(zip, "routes.txt");
  const tripsText = readGtfsFile(zip, "trips.txt");
  const stopsText = readGtfsFile(zip, "stops.txt");
  const stopTimesText = readGtfsFile(zip, "stop_times.txt");
  const agencyText = readGtfsFile(zip, "agency.txt");
  if (!routesText || !tripsText || !stopsText || !stopTimesText) {
    console.warn(`  ${operatorId}: missing GTFS tables`);
    return { stops: [], connections: [], calendars: [] };
  }

  const agencies = agencyText ? parseCsv(agencyText) : [];
  const routes = parseCsv<RouteRow>(routesText);
  const trips = parseCsv<TripRow>(tripsText);
  const stopRows = parseCsv<StopRow>(stopsText);
  const stopTimes = parseCsv<StopTimeRow>(stopTimesText);
  const calendars = parseCsv<CalendarRow>(readGtfsFile(zip, "calendar.txt") ?? "");
  const calendarDates = parseCsv<CalendarDateRow>(readGtfsFile(zip, "calendar_dates.txt") ?? "");

  const coverage = coverageForAgencyId(operatorId);
  if (!coverage?.agency.covered) {
    return { stops: [], connections: [], calendars };
  }

  const keptRoutes = new Set<string>();
  for (const route of routes) {
    const agencyId = route.agency_id || agencies[0]?.agency_id || operatorId;
    const rowCoverage = coverageForAgencyId(agencyId) ?? coverage;
    const name = `${route.route_short_name ?? ""} ${route.route_long_name ?? ""}`;
    if (shouldRoute(rowCoverage.agency, operatorId, route.route_type, name)) {
      keptRoutes.add(route.route_id);
    }
  }

  const date = serviceDate ?? pickServiceDate(calendars);
  let services = activeServices(calendars, calendarDates, date);
  if (!services.size) {
    for (const trip of trips) {
      if (keptRoutes.has(trip.route_id)) services.add(trip.service_id);
    }
  }

  const keptTrips = new Map<string, { routeId: string }>();
  for (const trip of trips) {
    if (!keptRoutes.has(trip.route_id) || !services.has(trip.service_id)) continue;
    keptTrips.set(trip.trip_id, { routeId: trip.route_id });
  }

  const stopById = new Map<string, StopRow>();
  for (const stop of stopRows) stopById.set(stop.stop_id, stop);

  const nodes: StopNode[] = [];
  const usedStops = new Set<string>();
  const timesByTrip = new Map<string, { stopId: string; seq: number; arr: number; dep: number }[]>();

  for (const row of stopTimes) {
    const trip = keptTrips.get(row.trip_id);
    if (!trip) continue;
    const arr = parseGtfsTime(row.arrival_time || row.departure_time);
    const dep = parseGtfsTime(row.departure_time || row.arrival_time);
    if (arr == null || dep == null) continue;
    if (dep > BOARD_END_SEC || arr < DEPART_SEC - 30 * 60) continue;
    const list = timesByTrip.get(row.trip_id) ?? [];
    list.push({
      stopId: row.stop_id,
      seq: Number(row.stop_sequence),
      arr,
      dep,
    });
    timesByTrip.set(row.trip_id, list);
    usedStops.add(row.stop_id);
  }

  for (const stopId of usedStops) {
    const stop = stopById.get(stopId);
    if (!stop) continue;
    const lon = Number(stop.stop_lon);
    const lat = Number(stop.stop_lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    nodes.push({
      id: `${coverage.key}::${stop.stop_id}`,
      agencyKey: coverage.key,
      stopId: stop.stop_id,
      name: stop.stop_name,
      lon,
      lat,
    });
  }

  const connections: Connection[] = [];
  for (const [tripId, times] of timesByTrip) {
    const trip = keptTrips.get(tripId);
    if (!trip) continue;
    times.sort((a, b) => a.seq - b.seq);
    const routeKey = reachKey(coverage.key, trip.routeId);
    for (let i = 0; i < times.length - 1; i += 1) {
      const from = times[i];
      const to = times[i + 1];
      if (to.arr < from.dep) continue;
      connections.push({
        from: `${coverage.key}::${from.stopId}`,
        to: `${coverage.key}::${to.stopId}`,
        dep: from.dep,
        arr: to.arr,
        trip: `${coverage.key}::${tripId}`,
        routeKey,
      });
    }
  }

  console.log(
    `  ${operatorId}: ${keptRoutes.size} routes, ${keptTrips.size} trips, ${nodes.length} stops, ${connections.length} hops`,
  );
  return { stops: nodes, connections, calendars };
}

function destinationMinutes(
  arrivals: Map<string, number>,
  stops: StopNode[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const destination of destinations) {
    if (!destination.covered) {
      result[destination.id] = null;
      continue;
    }
    const walkFromCampus = walkSeconds(
      haversineMiles(
        SJSU.longitude,
        SJSU.latitude,
        destination.longitude,
        destination.latitude,
      ),
    );
    let best = walkFromCampus <= MAX_DESTINATION_WALK_SEC ? walkFromCampus / 60 : Infinity;
    for (const stop of stops) {
      const arrival = arrivals.get(stop.id);
      if (arrival == null) continue;
      const walk = walkSeconds(
        haversineMiles(stop.lon, stop.lat, destination.longitude, destination.latitude),
      );
      if (walk > MAX_DESTINATION_WALK_SEC) continue;
      const minutes = (arrival - DEPART_SEC + walk) / 60;
      if (minutes < best) best = minutes;
    }
    result[destination.id] = Number.isFinite(best) ? Math.round(best) : null;
  }
  return result;
}

async function main() {
  loadDotEnv();
  const feeds = feedsToRoute();
  console.log(`Building covered isochrones from ${feeds.length} operators (weekday 8:00 a.m.)…`);

  const allStops: StopNode[] = [];
  const allConnections: Connection[] = [];
  const allCalendars: CalendarRow[] = [];
  for (const feed of feeds) {
    const extracted = loadOperator(feed.operatorId, null);
    allCalendars.push(...extracted.calendars);
    allStops.push(...extracted.stops);
    allConnections.push(...extracted.connections);
  }

  if (!allStops.length) {
    throw new Error("No stops loaded. Run npm run import:gtfs so data/cache has operator zips.");
  }

  const serviceDate = pickServiceDate(allCalendars);
  console.log(`Service date ${formatYmd(serviceDate)}. ${allStops.length} stops, ${allConnections.length} connections.`);
  console.log("Computing walk graph…");
  const neighbors = buildWalkGraph(allStops);
  console.log("Running connection scan…");
  const arrivals = runCsa(allStops, allConnections, neighbors);
  console.log(`Reachable stops: ${arrivals.size}`);

  const routeMin = new Map<string, number>();
  const routeMax = new Map<string, number>();
  for (const connection of allConnections) {
    const arrival = arrivals.get(connection.to);
    if (arrival == null) continue;
    const minutes = (arrival - DEPART_SEC) / 60;
    if (minutes < 0 || minutes > 180) continue;
    routeMin.set(connection.routeKey, Math.min(routeMin.get(connection.routeKey) ?? Infinity, minutes));
    routeMax.set(connection.routeKey, Math.max(routeMax.get(connection.routeKey) ?? 0, minutes));
  }

  const stopTimes: Record<string, number> = {};
  for (const [id, arrival] of arrivals) {
    const minutes = Math.round((arrival - DEPART_SEC) / 60);
    if (minutes >= 0 && minutes <= 180) stopTimes[id] = minutes;
  }

  const destTimes = destinationMinutes(arrivals, allStops);

  const features: GeoJSON.Feature[] = [];
  for (const cutoff of ISOCHRONE_CUTOFFS) {
    const circles: { lon: number; lat: number; radiusMiles: number }[] = [
      { lon: SJSU.longitude, lat: SJSU.latitude, radiusMiles: Math.min(cutoff, MAX_ACCESS_SEC / 60) * (WALK_M_PER_SEC * 60) / 1609.344 },
    ];
    for (const stop of allStops) {
      const arrival = arrivals.get(stop.id);
      if (arrival == null) continue;
      const elapsed = (arrival - DEPART_SEC) / 60;
      if (elapsed > cutoff) continue;
      const remainMin = Math.min(MAX_EGRESS_SEC / 60, cutoff - elapsed);
      const radiusMiles = Math.max(0.12, (remainMin * 60 * WALK_M_PER_SEC) / 1609.344);
      circles.push({ lon: stop.lon, lat: stop.lat, radiusMiles });
    }
    const geometry = circlesToMultiPolygon(circles);
    if (!geometry) continue;
    features.push({
      type: "Feature",
      properties: {
        kind: "isochrone",
        minutes: String(cutoff),
        label: cutoff < 60 ? `${cutoff} min` : `${cutoff / 60} hr`,
      },
      geometry,
    });
    console.log(`  ${cutoff} min: ${circles.length} walk circles`);
  }

  mkdirSync(dirname(ISOCHRONE_PATH), { recursive: true });
  writeFileSync(ISOCHRONE_PATH, JSON.stringify({ type: "FeatureCollection", features }));

  const reach: ReachIndex = {
    version: 1,
    departureLabel: ISOCHRONE_DEPARTURE_LABEL,
    cutoffs: [...ISOCHRONE_CUTOFFS],
    routes: {},
    stops: stopTimes,
    destinations: destTimes,
  };
  for (const [key, min] of routeMin) {
    reach.routes[key] = { min: Math.round(min), max: Math.round(routeMax.get(key) ?? min) };
  }
  writeFileSync(REACH_PATH, JSON.stringify(reach));
  console.log(`Wrote ${features.length} isochrones to ${ISOCHRONE_PATH}`);
  console.log(`Wrote reach index (${Object.keys(reach.routes).length} routes) to ${REACH_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
