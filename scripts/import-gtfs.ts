import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { CONNECT_DEGREES, EXTRA_FARE_AMBER, SAN_JOSE_CONNECT } from "../src/lib/constants";
import {
  agencyEntries,
  coverageForAgencyId,
  type CoverageAgency,
  type TransitMode,
} from "../src/lib/coverage";
import { hubLabelForStop, isCableCar, isHighway17Express, modeFromRouteType } from "../src/lib/mode";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = join(ROOT, "data/generated/network.geojson");
const CACHE_DIR = join(ROOT, "data/cache");
const MAX_SHAPE_POINTS = 80;

type CsvRow = Record<string, string>;

type RouteRow = CsvRow & {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name?: string;
  route_color?: string;
  route_type?: string;
};

type TripRow = CsvRow & {
  route_id: string;
  shape_id?: string;
};

type ShapeRow = CsvRow & {
  shape_id: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
  shape_pt_sequence: string;
  shape_dist_traveled?: string;
};

type StopRow = CsvRow & {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type?: string;
  parent_station?: string;
};

type AgencyRow = CsvRow & {
  agency_id?: string;
  agency_name?: string;
};

type GeoJsonFeature = {
  type: "Feature";
  id: string;
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | boolean | number>;
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

function lineColor(raw: string | undefined, fallback: string): string {
  const hex = (raw ?? "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luminance > 0.75) return fallback;
  return `#${hex.toUpperCase()}`;
}

function shapeLength(points: ShapeRow[]): number {
  const last = points.at(-1);
  const traveled = Number(last?.shape_dist_traveled);
  if (Number.isFinite(traveled) && traveled > 0) return traveled;
  return points.length;
}

function simplify(coordinates: [number, number][]): [number, number][] {
  if (coordinates.length <= MAX_SHAPE_POINTS) return coordinates;
  const step = Math.ceil((coordinates.length - 1) / (MAX_SHAPE_POINTS - 1));
  const simplified: [number, number][] = [];
  for (let i = 0; i < coordinates.length - 1; i += step) {
    simplified.push(coordinates[i]);
  }
  simplified.push(coordinates[coordinates.length - 1]);
  return simplified;
}

async function downloadOperatorFeed(
  operatorId: string,
  gtfsUrl: string | undefined,
  apiKey: string | undefined,
): Promise<Buffer> {
  const cachePath = join(CACHE_DIR, `${operatorId}.zip`);
  if (!process.env.FORCE_REFRESH && existsSync(cachePath) && isZip(readFileSync(cachePath))) {
    return readFileSync(cachePath);
  }

  const url = gtfsUrl
    ? new URL(gtfsUrl)
    : (() => {
        if (!apiKey) {
          throw new Error(`${operatorId}: missing FIVE11_API_KEY`);
        }
        const feed = new URL("https://api.511.org/transit/datafeeds");
        feed.searchParams.set("api_key", apiKey);
        feed.searchParams.set("operator_id", operatorId);
        return feed;
      })();

  const response = await fetch(url, {
    headers: { "User-Agent": "BayPass/0.1 (SJSU transit map)" },
  });
  const buffer = stripBom(Buffer.from(await response.arrayBuffer()));

  if (!response.ok || !isZip(buffer)) {
    const preview = buffer.subarray(0, 400).toString("utf8");
    const source = gtfsUrl ?? "511";
    throw new Error(
      `${operatorId}: GTFS download failed from ${source} (${response.status} ${response.statusText}). ${preview}`,
    );
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, buffer);
  return buffer;
}

function loadLocalZip(path: string): Buffer {
  const buffer = stripBom(readFileSync(path));
  if (!isZip(buffer)) {
    throw new Error(`GTFS_ZIP is not a zip file: ${path}`);
  }
  return buffer;
}

function nearSanJose(coordinates: [number, number][]): boolean {
  for (const [longitude, latitude] of coordinates) {
    for (const hub of SAN_JOSE_CONNECT) {
      if (
        Math.hypot(longitude - hub.longitude, latitude - hub.latitude) < CONNECT_DEGREES
      ) {
        return true;
      }
    }
  }
  return false;
}

function shouldIncludeRoute(
  agency: CoverageAgency,
  routeType: string | undefined,
  routeName: string,
  routeShortName: string,
): { include: boolean; covered: boolean } {
  const highway17 =
    agency.exceptions.includes("highway_17_express") &&
    isHighway17Express(routeName, routeShortName);

  if (agency.covered) {
    if (agency.exceptions.includes("cable_car") && isCableCar(routeType, routeName)) {
      return { include: false, covered: true };
    }
    return { include: true, covered: true };
  }

  if (highway17) return { include: true, covered: false };
  return { include: false, covered: false };
}

function buildFeatures(
  zip: AdmZip,
  operatorId: string,
  seenHubs: Set<string>,
): GeoJsonFeature[] {
  const agencyText = readGtfsFile(zip, "agency.txt");
  const routesText = readGtfsFile(zip, "routes.txt");
  const tripsText = readGtfsFile(zip, "trips.txt");
  const shapesText = readGtfsFile(zip, "shapes.txt");
  const stopsText = readGtfsFile(zip, "stops.txt");
  if (!agencyText || !routesText || !tripsText || !shapesText || !stopsText) {
    throw new Error(`${operatorId}: GTFS zip is missing a required file`);
  }

  const agencies = parseCsv<AgencyRow>(agencyText);
  const routes = parseCsv<RouteRow>(routesText);
  const trips = parseCsv<TripRow>(tripsText);
  const shapes = parseCsv<ShapeRow>(shapesText);
  const stops = parseCsv<StopRow>(stopsText);

  const pointsByShape = new Map<string, ShapeRow[]>();
  for (const point of shapes) {
    const list = pointsByShape.get(point.shape_id) ?? [];
    list.push(point);
    pointsByShape.set(point.shape_id, list);
  }
  for (const list of pointsByShape.values()) {
    list.sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));
  }

  const shapeIdsByRoute = new Map<string, Set<string>>();
  for (const trip of trips) {
    if (!trip.shape_id) continue;
    const set = shapeIdsByRoute.get(trip.route_id) ?? new Set<string>();
    set.add(trip.shape_id);
    shapeIdsByRoute.set(trip.route_id, set);
  }

  const features: GeoJsonFeature[] = [];
  const agencyModes = new Map<string, Set<TransitMode>>();

  for (const route of routes) {
    const agencyId = route.agency_id || agencies[0]?.agency_id || operatorId;
    const coverage = coverageForAgencyId(agencyId) ?? coverageForAgencyId(operatorId);
    if (!coverage) continue;

    const routeName = `${route.route_short_name ?? ""} ${route.route_long_name ?? ""}`;
    const inclusion = shouldIncludeRoute(
      coverage.agency,
      route.route_type,
      routeName,
      route.route_short_name ?? "",
    );
    if (!inclusion.include) continue;

    const mode = modeFromRouteType(route.route_type);
    const modes = agencyModes.get(coverage.key) ?? new Set<TransitMode>();
    modes.add(mode);
    agencyModes.set(coverage.key, modes);

    const shapeIds = shapeIdsByRoute.get(route.route_id);
    if (!shapeIds?.size) continue;

    let bestId: string | null = null;
    let bestLength = -1;
    for (const shapeId of shapeIds) {
      const points = pointsByShape.get(shapeId);
      if (!points?.length) continue;
      const length = shapeLength(points);
      if (length > bestLength) {
        bestLength = length;
        bestId = shapeId;
      }
    }
    if (!bestId) continue;

    const coordinates = simplify(
      (pointsByShape.get(bestId) ?? []).map(
        (point) => [Number(point.shape_pt_lon), Number(point.shape_pt_lat)] as [number, number],
      ),
    );
    if (coordinates.length < 2) continue;

    const connected = coverage.key === "vta" || nearSanJose(coordinates);

    features.push({
      type: "Feature",
      id: `route-${coverage.key}-${route.route_id}`,
      geometry: { type: "LineString", coordinates },
      properties: {
        kind: "route",
        routeId: route.route_id,
        routeShortName: route.route_short_name ?? "",
        routeLongName: route.route_long_name ?? "",
        routeColor: inclusion.covered
          ? lineColor(route.route_color, coverage.agency.color)
          : EXTRA_FARE_AMBER,
        agencyId,
        agencyKey: coverage.key,
        agencyName: coverage.agency.name,
        mode,
        covered: inclusion.covered,
        connected,
        fare: inclusion.covered ? "covered" : "extra",
        connectedFromSj: connected ? "yes" : "no",
      },
    });
  }

  const defaultCoverage = coverageForAgencyId(operatorId);
  if (!defaultCoverage) return features;

  const parentStops = stops.filter((stop) => stop.location_type === "1");
  const railOrFerry = [...(agencyModes.get(defaultCoverage.key) ?? [])].some(
    (mode) => mode !== "bus",
  );
  const importantStop = /station|terminal|ferry|transit center|bart|caltrain|metro/i;
  let stationStops =
    parentStops.length > 0
      ? parentStops
      : railOrFerry
        ? [...new Map(
            stops
              .filter((stop) => !stop.parent_station)
              .map((stop) => [stop.stop_name, stop]),
          ).values()]
        : [];
  if (stationStops.length > 80) {
    stationStops = stationStops.filter(
      (stop) => hubLabelForStop(stop.stop_name) || importantStop.test(stop.stop_name),
    );
  }
  if (!defaultCoverage.agency.covered) {
    stationStops = stationStops.filter((stop) => hubLabelForStop(stop.stop_name));
  }

  const candidates = stationStops.length > 0 ? stationStops : stops;

  for (const stop of candidates) {
    const lon = Number(stop.stop_lon);
    const lat = Number(stop.stop_lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const hubLabel = hubLabelForStop(stop.stop_name);
    const isStation = stationStops.includes(stop);
    if (!isStation && !hubLabel) continue;
    if (hubLabel) {
      if (seenHubs.has(hubLabel)) continue;
      seenHubs.add(hubLabel);
    }

    const mode = railOrFerry
      ? ([...(agencyModes.get(defaultCoverage.key) ?? [])].find((item) => item !== "bus") ?? "rail")
      : "bus";

    const connected =
      defaultCoverage.key === "vta" ||
      !defaultCoverage.agency.covered ||
      nearSanJose([[lon, lat]]);

    features.push({
      type: "Feature",
      id: `stop-${defaultCoverage.key}-${stop.stop_id}`,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        kind: "stop",
        stopId: stop.stop_id,
        stopName: stop.stop_name,
        agencyId: operatorId,
        agencyKey: defaultCoverage.key,
        agencyName: defaultCoverage.agency.name,
        mode,
        covered: defaultCoverage.agency.covered,
        connected,
        fare: defaultCoverage.agency.covered ? "covered" : "extra",
        connectedFromSj: connected ? "yes" : "no",
        isHub: Boolean(hubLabel),
        hubLabel: hubLabel ?? "",
      },
    });
  }

  return features;
}

function feedsToImport(): { operatorId: string; gtfsUrl?: string }[] {
  const seen = new Set<string>();
  const feeds: { operatorId: string; gtfsUrl?: string }[] = [];
  for (const [, agency] of agencyEntries) {
    if (!agency.covered && agency.exceptions.length === 0) continue;
    for (const id of agency.gtfsIds) {
      if (id === "1000" || seen.has(id)) continue;
      seen.add(id);
      feeds.push({ operatorId: id, gtfsUrl: agency.gtfsUrl });
    }
  }
  return feeds;
}

async function main() {
  loadDotEnv();

  const localZip = process.env.GTFS_ZIP;
  const apiKey = process.env.FIVE11_API_KEY;
  const features: GeoJsonFeature[] = [];
  const seenHubs = new Set<string>();

  if (localZip) {
    console.log(`Reading local GTFS zip: ${localZip}`);
    features.push(...buildFeatures(new AdmZip(loadLocalZip(localZip)), "LOCAL", seenHubs));
  } else {
    const feeds = feedsToImport();
    if (!apiKey && feeds.some((feed) => !feed.gtfsUrl)) {
      throw new Error(
        "Set FIVE11_API_KEY in .env.local (https://511.org/open-data) or GTFS_ZIP to a local feed.",
      );
    }
    console.log(`Downloading ${feeds.length} GTFS operators…`);
    for (const feed of feeds) {
      try {
        const buffer = await downloadOperatorFeed(feed.operatorId, feed.gtfsUrl, apiKey);
        const extracted = buildFeatures(new AdmZip(buffer), feed.operatorId, seenHubs);
        const routes = extracted.filter((feature) => feature.properties.kind === "route").length;
        const stops = extracted.filter((feature) => feature.properties.kind === "stop").length;
        console.log(`  ${feed.operatorId}: ${routes} routes, ${stops} stations`);
        features.push(...extracted);
      } catch (error) {
        console.warn(`  ${feed.operatorId}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({
      type: "FeatureCollection",
      features,
    }),
  );

  const routes = features.filter((feature) => feature.properties.kind === "route").length;
  const stops = features.filter((feature) => feature.properties.kind === "stop").length;
  console.log(`Wrote ${routes} routes and ${stops} stations to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
