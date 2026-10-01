import destinationsFile from "../../data/destinations.json";
import { SJSU } from "@/lib/constants";
import { haversineMiles, milesFromSjsu } from "@/lib/geo";
import {
  destinationReachMinutes,
  type ReachIndex,
} from "@/lib/isochrone";
import type {
  Destination,
  DestinationCategory,
  DestinationSelection,
} from "@/lib/types";

type DestinationFile = {
  version: number;
  categories: { id: DestinationCategory; label: string }[];
  destinations: Destination[];
};

const catalog = destinationsFile as DestinationFile;

export const destinationCategories = catalog.categories;

export const destinations: Destination[] = catalog.destinations;

export const DEFAULT_DESTINATION_CATEGORIES: DestinationCategory[] =
  destinationCategories.map((category) => category.id);

export function destinationById(id: string): Destination | null {
  return destinations.find((destination) => destination.id === id) ?? null;
}

export function walkMilesToStop(destination: Destination): number | null {
  if (
    destination.nearbyStopLongitude === undefined ||
    destination.nearbyStopLatitude === undefined
  ) {
    return null;
  }
  return haversineMiles(
    destination.longitude,
    destination.latitude,
    destination.nearbyStopLongitude,
    destination.nearbyStopLatitude,
  );
}

export function destinationMilesFromSjsu(destination: Destination): number {
  return milesFromSjsu(destination.longitude, destination.latitude);
}

export function toDestinationSelection(
  destination: Destination,
  reach: ReachIndex | null = null,
): DestinationSelection {
  return {
    type: "destination",
    destination,
    milesFromSjsu: destinationMilesFromSjsu(destination),
    walkMiles: walkMilesToStop(destination),
    reachMinutes: destinationReachMinutes(destination, reach),
  };
}

export function transitDirectionsUrl(destination: Destination): string {
  const origin = `${SJSU.latitude},${SJSU.longitude}`;
  const target = `${destination.latitude},${destination.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${target}&travelmode=transit`;
}

export function formatMiles(miles: number): string {
  if (miles < 0.08) return "at the stop";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function destinationCollection(
  reach: ReachIndex | null = null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: destinations.map((destination) => {
      const minutes = destinationReachMinutes(destination, reach);
      return {
        type: "Feature",
        properties: {
          kind: "destination",
          destinationId: destination.id,
          name: destination.name,
          shortName: destination.shortName,
          category: destination.category,
          fare: destination.covered ? "covered" : "extra",
          showLabel: destination.showLabel ? "yes" : "no",
          labelRank: destination.labelRank,
          reachMin: minutes == null ? "9999" : String(minutes),
        },
        geometry: {
          type: "Point",
          coordinates: [destination.longitude, destination.latitude],
        },
      };
    }),
  };
}
