import type { TransitMode } from "@/lib/coverage";

const GTFS_ROUTE_TYPE: Record<string, TransitMode> = {
  "0": "light_rail",
  "1": "rail",
  "2": "rail",
  "3": "bus",
  "4": "ferry",
  "5": "light_rail",
  "11": "bus",
  "12": "rail",
};

export function modeFromRouteType(routeType: string | undefined): TransitMode {
  return GTFS_ROUTE_TYPE[routeType ?? ""] ?? "bus";
}

export function isCableCar(routeType: string | undefined, routeName: string): boolean {
  if (routeType === "5") return true;
  return /cable\s*car/i.test(routeName);
}

export function isHighway17Express(routeName: string, routeShortName = ""): boolean {
  if (/^17$/.test(routeShortName.trim())) return true;
  return /highway\s*17|hwy\s*17|\b17\s*express\b/i.test(`${routeShortName} ${routeName}`);
}

export function hubLabelForStop(name: string): string | null {
  if (/diridon/i.test(name)) return "Diridon";
  if (/berryessa/i.test(name)) return "Berryessa";
  if (/millbrae/i.test(name)) return "Millbrae";
  if (/salesforce|transbay transit/i.test(name)) return "Salesforce";
  if (/^san francisco( caltrain)?( station)?$/i.test(name)) return "San Francisco";
  if (/cavallaro/i.test(name)) return "Scotts Valley";
  if (/soquel ave & front|front & soquel/i.test(name)) return "Santa Cruz";
  return null;
}
