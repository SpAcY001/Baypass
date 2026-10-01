import { SJSU } from "@/lib/constants";

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function milesFromSjsu(longitude: number, latitude: number): number {
  return haversineMiles(SJSU.longitude, SJSU.latitude, longitude, latitude);
}

function ringCoordinates(
  longitude: number,
  latitude: number,
  miles: number,
  steps = 96,
): [number, number][] {
  const latRad = (latitude * Math.PI) / 180;
  const dLat = miles / 69.0;
  const dLng = miles / (69.0 * Math.cos(latRad));
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    coordinates.push([longitude + dLng * Math.cos(theta), latitude + dLat * Math.sin(theta)]);
  }
  return coordinates;
}

export function distanceRingCollection(
  miles: readonly number[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = miles.flatMap((value) => {
    const coordinates = ringCoordinates(SJSU.longitude, SJSU.latitude, value);
    const east = coordinates[0];
    return [
      {
        type: "Feature",
        properties: { kind: "ring", miles: value, label: `${value} mi` },
        geometry: { type: "LineString", coordinates },
      },
      {
        type: "Feature",
        properties: { kind: "ring-label", miles: value, label: `${value} mi from SJSU` },
        geometry: { type: "Point", coordinates: east },
      },
    ];
  });

  return { type: "FeatureCollection", features };
}
