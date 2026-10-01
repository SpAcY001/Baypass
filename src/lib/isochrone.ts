import type { Destination } from "@/lib/types";

export const ISOCHRONE_CUTOFFS = [30, 60, 120, 180] as const;

export type IsochroneCutoff = (typeof ISOCHRONE_CUTOFFS)[number];

export const ANYWHERE = "anywhere" as const;

export type DurationChoice = IsochroneCutoff | typeof ANYWHERE;

export const DEFAULT_DURATION: DurationChoice = 60;

export const ISOCHRONE_DEPARTURE_LABEL = "weekday 8:00 a.m.";

export const DURATION_OPTIONS: { id: DurationChoice; label: string }[] = [
  { id: 30, label: "30 min" },
  { id: 60, label: "1 hr" },
  { id: 120, label: "2 hr" },
  { id: 180, label: "3 hr" },
  { id: ANYWHERE, label: "Anywhere" },
];

export const ISOCHRONES_URL = "/api/isochrones";
export const REACH_URL = "/api/reach";

export type ReachIndex = {
  version: number;
  departureLabel: string;
  cutoffs: IsochroneCutoff[];
  routes: Record<string, { min: number; max: number }>;
  stops: Record<string, number>;
  destinations: Record<string, number | null>;
};

export function reachKey(agencyKey: string, id: string): string {
  return `${agencyKey}::${id}`;
}

export function formatReachMinutes(minutes: number): string {
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `about ${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (rest === 0) return `about ${hours} hr`;
  return `about ${hours} hr ${rest} min`;
}

export function destinationReachMinutes(
  destination: Destination,
  reach: ReachIndex | null,
): number | null | undefined {
  if (!reach) return undefined;
  if (!(destination.id in reach.destinations)) return undefined;
  return reach.destinations[destination.id];
}

export function isWithinDuration(
  minutes: number | null | undefined,
  duration: DurationChoice,
): boolean {
  if (duration === ANYWHERE) return true;
  if (minutes == null) return false;
  return minutes <= duration;
}
