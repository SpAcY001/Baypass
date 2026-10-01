import type { TransitMode } from "@/lib/coverage";

export const SJSU = {
  name: "SJSU",
  longitude: -121.8811,
  latitude: 37.3352,
} as const;

export const DIRIDON = {
  name: "San José Diridon",
  longitude: -121.9026,
  latitude: 37.3297,
} as const;

export const BERRYESSA = {
  name: "Berryessa/North San José",
  longitude: -121.8747,
  latitude: 37.3684,
} as const;

export const SAN_JOSE_CONNECT = [SJSU, DIRIDON, BERRYESSA] as const;

export const CONNECT_DEGREES = 0.03;

export const RING_MILES = [10, 25, 50] as const;

export const EXTRA_FARE_AMBER = "#D97706";

export const DEFAULT_VIEW = {
  center: [SJSU.longitude, SJSU.latitude] as [number, number],
  zoom: 10.5,
} as const;

export const CALTRAIN_RED = "#C8102E";
export const SJSU_BLUE = "#0055A2";
export const SJSU_GOLD = "#E5A823";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export const NETWORK_URL = "/api/network";

export const ATTRIBUTION =
  "Transit data © 511 SF Bay. Map © OpenFreeMap / OpenStreetMap contributors.";

export const MODES: { id: TransitMode; label: string }[] = [
  { id: "rail", label: "Rail" },
  { id: "light_rail", label: "Light rail" },
  { id: "bus", label: "Bus" },
  { id: "ferry", label: "Ferry" },
];

export const DEFAULT_MODES: TransitMode[] = ["rail", "light_rail", "ferry"];

export const LAYER_MINZOOM = {
  rail: 6,
  ferry: 6,
  light_rail: 9,
  bus: 13,
  unpaid: 7,
  station: 8,
  hub: 7,
  rings: 6,
  destination: 7,
  destinationLabelMajor: 8,
  destinationLabelLocal: 10,
  isochrone: 6,
} as const;
