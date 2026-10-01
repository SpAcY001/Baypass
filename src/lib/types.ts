import type { TransitMode } from "@/lib/coverage";

export type FeatureKind = "route" | "stop";

export type RouteProperties = {
  kind: "route";
  routeId: string;
  routeShortName: string;
  routeLongName: string;
  routeColor: string;
  agencyId: string;
  agencyKey: string;
  agencyName: string;
  mode: TransitMode;
  covered: boolean;
  connected: boolean;
  fare: "covered" | "extra";
  connectedFromSj?: "yes" | "no";
  reachMin?: number;
  reachMax?: number;
};

export type StopProperties = {
  kind: "stop";
  stopId: string;
  stopName: string;
  agencyId: string;
  agencyKey: string;
  agencyName: string;
  mode: TransitMode;
  covered: boolean;
  connected: boolean;
  isHub: boolean;
  hubLabel: string;
  connectedFromSj?: "yes" | "no";
  reachMin?: number;
};

export type NetworkProperties = RouteProperties | StopProperties;

export type DestinationCategory =
  | "hub"
  | "downtown"
  | "campus"
  | "stadium"
  | "waterfront"
  | "airport"
  | "extra_fare";

export type Destination = {
  id: string;
  name: string;
  shortName: string;
  category: DestinationCategory;
  longitude: number;
  latitude: number;
  covered: boolean;
  agencyKeys: string[];
  connectVia: string;
  how: string;
  nearbyStopName: string;
  nearbyStopLongitude?: number;
  nearbyStopLatitude?: number;
  labelRank: "major" | "local";
  showLabel: boolean;
};

export type GapSelection = {
  type: "gap";
  longitude: number;
  latitude: number;
  nearestName: string;
  distanceMiles: number;
  extraFareHint: string | null;
};

export type DestinationSelection = {
  type: "destination";
  destination: Destination;
  milesFromSjsu: number;
  walkMiles: number | null;
  reachMinutes?: number | null;
};

export type Selection =
  | { type: "route"; properties: RouteProperties }
  | { type: "station"; properties: StopProperties }
  | { type: "origin" }
  | DestinationSelection
  | GapSelection
  | null;
