"use client";

import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type FilterSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import NetworkFilters from "@/components/NetworkFilters";
import SelectionSheet from "@/components/SelectionSheet";
import {
  ATTRIBUTION,
  DEFAULT_MODES,
  DEFAULT_VIEW,
  EXTRA_FARE_AMBER,
  LAYER_MINZOOM,
  MAP_STYLE,
  NETWORK_URL,
  RING_MILES,
  SJSU,
  SJSU_BLUE,
  SJSU_GOLD,
} from "@/lib/constants";
import { defaultEnabledAgencies, type TransitMode } from "@/lib/coverage";
import {
  DEFAULT_DESTINATION_CATEGORIES,
  destinationById,
  destinationCollection,
  toDestinationSelection,
} from "@/lib/destinations";
import { distanceRingCollection, haversineMiles } from "@/lib/geo";
import {
  ANYWHERE,
  DEFAULT_DURATION,
  ISOCHRONES_URL,
  REACH_URL,
  reachKey,
  type DurationChoice,
  type ReachIndex,
} from "@/lib/isochrone";
import type {
  DestinationCategory,
  NetworkProperties,
  RouteProperties,
  Selection,
  StopProperties,
} from "@/lib/types";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const ROUTES_SOURCE = "network-routes";
const STOPS_SOURCE = "network-stops";
const ORIGIN_SOURCE = "sjsu-origin";
const RINGS_SOURCE = "sjsu-rings";
const DESTINATIONS_SOURCE = "sjsu-destinations";
const ISOCHRONE_SOURCE = "sjsu-isochrones";

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "yes";
}

function isNetworkProperties(value: unknown): value is NetworkProperties {
  if (!value || typeof value !== "object") return false;
  return "kind" in value && (value.kind === "route" || value.kind === "stop");
}

function coerceRoute(properties: NetworkProperties): RouteProperties {
  const route = properties as RouteProperties;
  const covered = asBool(route.covered);
  const reachMin = Number(route.reachMin);
  const reachMax = Number(route.reachMax);
  return {
    ...route,
    covered,
    connected: asBool(route.connected) || route.connectedFromSj === "yes",
    fare: covered ? "covered" : "extra",
    reachMin: Number.isFinite(reachMin) ? reachMin : undefined,
    reachMax: Number.isFinite(reachMax) ? reachMax : undefined,
  };
}

function coerceStop(properties: NetworkProperties): StopProperties {
  const stop = properties as StopProperties;
  const reachMin = Number(stop.reachMin);
  return {
    ...stop,
    covered: asBool(stop.covered),
    connected: asBool(stop.connected) || stop.connectedFromSj === "yes",
    isHub: asBool(stop.isHub),
    reachMin: Number.isFinite(reachMin) ? reachMin : undefined,
  };
}

function extraFareHint(latitude: number, longitude: number): string | null {
  if (latitude < 37.28 && longitude < -121.82) {
    return "Possible paid connection: Highway 17 Express from Diridon to Santa Cruz.";
  }
  return null;
}

function attachRouteReach(
  feature: GeoJSON.Feature,
  reach: ReachIndex | null,
): GeoJSON.Feature {
  if (!reach || !feature.properties) return feature;
  const key = reachKey(String(feature.properties.agencyKey), String(feature.properties.routeId));
  const times = reach.routes[key];
  return {
    ...feature,
    properties: {
      ...feature.properties,
      reachMin: times ? String(times.min) : "9999",
      reachMax: times ? String(times.max) : "9999",
    },
  };
}

function attachStopReach(
  feature: GeoJSON.Feature,
  reach: ReachIndex | null,
): GeoJSON.Feature {
  if (!reach || !feature.properties) return feature;
  const key = reachKey(String(feature.properties.agencyKey), String(feature.properties.stopId));
  const minutes = reach.stops[key];
  return {
    ...feature,
    properties: {
      ...feature.properties,
      reachMin: minutes == null ? "9999" : String(minutes),
    },
  };
}

function splitNetwork(data: GeoJSON.FeatureCollection) {
  const routes: GeoJSON.Feature[] = [];
  const stops: GeoJSON.Feature[] = [];
  for (const feature of data.features) {
    if (feature.properties?.kind === "route") routes.push(feature);
    if (feature.properties?.kind === "stop") stops.push(feature);
  }
  return { routes, stops };
}

function visibilityFilter(
  extra: FilterSpecification,
  agencies: string[],
  modes: TransitMode[] | null,
  connectedOnly: boolean,
): FilterSpecification {
  const agencyKeys = agencies.length ? agencies : ["__none__"];
  const clauses: FilterSpecification[] = [
    extra,
    ["in", "agencyKey", ...agencyKeys],
  ];
  if (modes) {
    const modeKeys = modes.length ? modes : ["__none__"];
    clauses.push(["in", "mode", ...modeKeys]);
  }
  if (connectedOnly) {
    clauses.push(["==", "connectedFromSj", "yes"]);
  }
  return ["all", ...clauses] as FilterSpecification;
}

export default function TransitMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stopsRef = useRef<GeoJSON.Feature[]>([]);
  const reachRef = useRef<ReachIndex | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [enabledModes, setEnabledModes] = useState<TransitMode[]>(DEFAULT_MODES);
  const [enabledAgencies, setEnabledAgencies] = useState<string[]>(defaultEnabledAgencies);
  const [showRings, setShowRings] = useState(true);
  const [showDestinations, setShowDestinations] = useState(true);
  const [enabledDestinationCategories, setEnabledDestinationCategories] =
    useState<DestinationCategory[]>(DEFAULT_DESTINATION_CATEGORIES);
  const [connectedOnly, setConnectedOnly] = useState(true);
  const [duration, setDuration] = useState<DurationChoice>(DEFAULT_DURATION);
  const [hasData, setHasData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const map = new MapLibreMap({
      container,
      style: MAP_STYLE,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }),
      "bottom-left",
    );
    map.on("error", (event) => {
      if (!cancelled && event.error?.message) {
        console.error(event.error);
      }
    });

    const addNetwork = async () => {
      if (cancelled || map.getSource(ORIGIN_SOURCE)) return;

      map.addSource(RINGS_SOURCE, {
        type: "geojson",
        data: distanceRingCollection(RING_MILES),
      });
      map.addLayer({
        id: "distance-rings",
        type: "line",
        source: RINGS_SOURCE,
        minzoom: LAYER_MINZOOM.rings,
        filter: ["==", "kind", "ring"],
        paint: {
          "line-color": "#a8a29e",
          "line-width": 1.15,
          "line-dasharray": [2.4, 2.2],
          "line-opacity": 0.72,
        },
      });
      map.addLayer({
        id: "distance-ring-labels",
        type: "symbol",
        source: RINGS_SOURCE,
        minzoom: LAYER_MINZOOM.rings,
        filter: ["==", "kind", "ring-label"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "left",
          "text-offset": [0.4, 0],
        },
        paint: {
          "text-color": "#78716c",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      map.addSource(ISOCHRONE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "isochrone-fill",
        type: "fill",
        source: ISOCHRONE_SOURCE,
        minzoom: LAYER_MINZOOM.isochrone,
        filter: ["==", "minutes", String(DEFAULT_DURATION)],
        paint: {
          "fill-color": SJSU_BLUE,
          "fill-opacity": 0.16,
        },
      });
      map.addLayer({
        id: "isochrone-outline",
        type: "line",
        source: ISOCHRONE_SOURCE,
        minzoom: LAYER_MINZOOM.isochrone,
        filter: ["==", "minutes", String(DEFAULT_DURATION)],
        paint: {
          "line-color": SJSU_BLUE,
          "line-width": 1.2,
          "line-opacity": 0.45,
        },
      });

      map.addSource(ORIGIN_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "origin", name: SJSU.name },
              geometry: {
                type: "Point",
                coordinates: [SJSU.longitude, SJSU.latitude],
              },
            },
          ],
        },
      });
      map.addLayer({
        id: "sjsu-halo",
        type: "circle",
        source: ORIGIN_SOURCE,
        paint: {
          "circle-radius": 18,
          "circle-color": SJSU_GOLD,
          "circle-opacity": 0.28,
        },
      });
      map.addLayer({
        id: "sjsu-dot",
        type: "circle",
        source: ORIGIN_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": SJSU_BLUE,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      try {
        const [networkResponse, isochroneResponse, reachResponse] = await Promise.all([
          fetch(NETWORK_URL),
          fetch(ISOCHRONES_URL),
          fetch(REACH_URL),
        ]);
        if (!networkResponse.ok) {
          const payload = (await networkResponse.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "Could not load network data.");
        }
        const data = (await networkResponse.json()) as GeoJSON.FeatureCollection;
        const isochrones = isochroneResponse.ok
          ? ((await isochroneResponse.json()) as GeoJSON.FeatureCollection)
          : { type: "FeatureCollection" as const, features: [] };
        const reach = reachResponse.ok
          ? ((await reachResponse.json()) as ReachIndex)
          : null;
        if (cancelled) return;

        reachRef.current = reach;
        const { routes, stops } = splitNetwork(data);
        const reachedRoutes = routes.map((feature) => attachRouteReach(feature, reach));
        const reachedStops = stops.map((feature) => attachStopReach(feature, reach));
        stopsRef.current = reachedStops;
        const isoSource = map.getSource(ISOCHRONE_SOURCE);
        if (isoSource && isoSource.type === "geojson") {
          (isoSource as GeoJSONSource).setData(isochrones);
        }
        map.addSource(ROUTES_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: reachedRoutes },
        });
        map.addSource(STOPS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: reachedStops },
        });

        const lineLayer = (
          id: string,
          mode: TransitMode,
          minzoom: number,
          width: number,
          hit: boolean,
        ) => {
          map.addLayer({
            id,
            type: "line",
            source: ROUTES_SOURCE,
            minzoom,
            filter: ["all", ["==", "mode", mode], ["==", "fare", "covered"]],
            paint: {
              "line-color": hit ? "#000000" : ["get", "routeColor"],
              "line-width": hit ? width + 12 : width,
              "line-opacity": hit ? 0 : 0.9,
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });
        };

        lineLayer("routes-rail", "rail", LAYER_MINZOOM.rail, 4, false);
        lineLayer("routes-rail-hit", "rail", LAYER_MINZOOM.rail, 4, true);
        lineLayer("routes-light-rail", "light_rail", LAYER_MINZOOM.light_rail, 3.2, false);
        lineLayer("routes-light-rail-hit", "light_rail", LAYER_MINZOOM.light_rail, 3.2, true);
        lineLayer("routes-ferry", "ferry", LAYER_MINZOOM.ferry, 3, false);
        lineLayer("routes-ferry-hit", "ferry", LAYER_MINZOOM.ferry, 3, true);
        lineLayer("routes-bus", "bus", LAYER_MINZOOM.bus, 2.2, false);
        lineLayer("routes-bus-hit", "bus", LAYER_MINZOOM.bus, 2.2, true);

        map.addLayer({
          id: "routes-extra",
          type: "line",
          source: ROUTES_SOURCE,
          minzoom: LAYER_MINZOOM.unpaid,
          filter: ["==", "fare", "extra"],
          paint: {
            "line-color": EXTRA_FARE_AMBER,
            "line-width": 3.4,
            "line-dasharray": [2.2, 1.6],
            "line-opacity": 0.95,
          },
          layout: {
            "line-cap": "butt",
            "line-join": "round",
          },
        });
        map.addLayer({
          id: "routes-extra-hit",
          type: "line",
          source: ROUTES_SOURCE,
          minzoom: LAYER_MINZOOM.unpaid,
          filter: ["==", "fare", "extra"],
          paint: {
            "line-color": EXTRA_FARE_AMBER,
            "line-width": 18,
            "line-opacity": 0.01,
          },
        });

        map.addLayer({
          id: "stops-stations",
          type: "circle",
          source: STOPS_SOURCE,
          minzoom: LAYER_MINZOOM.station,
          filter: ["!=", "isHub", true],
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffffff",
            "circle-stroke-width": 1.4,
            "circle-stroke-color": "#44403c",
          },
        });
        map.addLayer({
          id: "stops-hubs",
          type: "circle",
          source: STOPS_SOURCE,
          minzoom: LAYER_MINZOOM.hub,
          filter: ["==", "isHub", true],
          paint: {
            "circle-radius": 7,
            "circle-color": "#1c1917",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "stops-hub-labels",
          type: "symbol",
          source: STOPS_SOURCE,
          minzoom: LAYER_MINZOOM.station,
          filter: ["==", "isHub", true],
          layout: {
            "text-field": ["get", "hubLabel"],
            "text-size": 12,
            "text-font": ["Noto Sans Bold"],
            "text-offset": [0, 1.25],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#1c1917",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4,
          },
        });

        map.addSource(DESTINATIONS_SOURCE, {
          type: "geojson",
          data: destinationCollection(reach),
        });
        map.addLayer({
          id: "destinations-halo",
          type: "circle",
          source: DESTINATIONS_SOURCE,
          minzoom: LAYER_MINZOOM.destination,
          paint: {
            "circle-radius": 11,
            "circle-color": [
              "case",
              ["==", ["get", "fare"], "extra"],
              EXTRA_FARE_AMBER,
              SJSU_GOLD,
            ],
            "circle-opacity": 0.28,
          },
        });
        map.addLayer({
          id: "destinations-dot",
          type: "circle",
          source: DESTINATIONS_SOURCE,
          minzoom: LAYER_MINZOOM.destination,
          paint: {
            "circle-radius": 6,
            "circle-color": [
              "case",
              ["==", ["get", "fare"], "extra"],
              EXTRA_FARE_AMBER,
              SJSU_GOLD,
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "destinations-selected",
          type: "circle",
          source: DESTINATIONS_SOURCE,
          minzoom: LAYER_MINZOOM.destination,
          filter: ["==", "destinationId", "__none__"],
          paint: {
            "circle-radius": 9,
            "circle-color": [
              "case",
              ["==", ["get", "fare"], "extra"],
              EXTRA_FARE_AMBER,
              SJSU_GOLD,
            ],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#1c1917",
          },
        });
        map.addLayer({
          id: "destinations-labels-major",
          type: "symbol",
          source: DESTINATIONS_SOURCE,
          minzoom: LAYER_MINZOOM.destinationLabelMajor,
          filter: ["all", ["==", "showLabel", "yes"], ["==", "labelRank", "major"]],
          layout: {
            "text-field": ["get", "shortName"],
            "text-size": 12,
            "text-font": ["Noto Sans Bold"],
            "text-offset": [0, 1.2],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#44403c",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4,
          },
        });
        map.addLayer({
          id: "destinations-labels-local",
          type: "symbol",
          source: DESTINATIONS_SOURCE,
          minzoom: LAYER_MINZOOM.destinationLabelLocal,
          filter: ["all", ["==", "showLabel", "yes"], ["==", "labelRank", "local"]],
          layout: {
            "text-field": ["get", "shortName"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
            "text-offset": [0, 1.2],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#57534e",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.3,
          },
        });

        const interactive = [
          "destinations-dot",
          "destinations-halo",
          "destinations-selected",
          "routes-rail-hit",
          "routes-light-rail-hit",
          "routes-ferry-hit",
          "routes-bus-hit",
          "routes-extra",
          "routes-extra-hit",
          "stops-stations",
          "stops-hubs",
          "sjsu-dot",
          "sjsu-halo",
        ];
        for (const layer of interactive) {
          map.on("mouseenter", layer, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            map.getCanvas().style.cursor = "";
          });
        }

        map.on("click", (event: MapMouseEvent) => {
          const features = map.queryRenderedFeatures(event.point, {
            layers: interactive,
          });
          const feature = features[0];
          if (!feature) {
            const { lng, lat } = event.lngLat;
            let nearestName = "";
            let nearestMiles = Infinity;
            for (const stop of stopsRef.current) {
              if (stop.geometry.type !== "Point") continue;
              const [stopLng, stopLat] = stop.geometry.coordinates as [number, number];
              const miles = haversineMiles(lng, lat, stopLng, stopLat);
              if (miles < nearestMiles) {
                nearestMiles = miles;
                nearestName = String(stop.properties?.stopName ?? "a mapped station");
              }
            }
            if (!nearestName || nearestMiles > 80) {
              setSelection(null);
              return;
            }
            setSelection({
              type: "gap",
              longitude: lng,
              latitude: lat,
              nearestName,
              distanceMiles: nearestMiles,
              extraFareHint: extraFareHint(lat, lng),
            });
            return;
          }
          if (feature.layer.id.startsWith("destinations")) {
            const destinationId = String(feature.properties?.destinationId ?? "");
            const destination = destinationById(destinationId);
            if (destination) setSelection(toDestinationSelection(destination, reachRef.current));
            else setSelection(null);
            return;
          }
          if (feature.layer.id.startsWith("sjsu")) {
            setSelection({ type: "origin" });
            return;
          }
          const properties = feature.properties;
          if (!isNetworkProperties(properties)) {
            setSelection(null);
            return;
          }
          if (properties.kind === "route") {
            setSelection({ type: "route", properties: coerceRoute(properties) });
            return;
          }
          setSelection({
            type: "station",
            properties: coerceStop(properties),
          });
        });

        if (!cancelled) setHasData(true);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load network data.",
          );
        }
      }
    };

    const start = () => {
      void addNetwork();
    };
    if (map.isStyleLoaded()) start();
    else {
      map.once("load", start);
      map.once("style.load", start);
    }

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("routes-rail")) return;

    const apply = (
      layer: string,
      extra: FilterSpecification,
      modes: TransitMode[] | null,
    ) => {
      map.setFilter(layer, visibilityFilter(extra, enabledAgencies, modes, connectedOnly));
    };

    apply("routes-rail", ["all", ["==", "mode", "rail"], ["==", "fare", "covered"]], enabledModes);
    apply("routes-rail-hit", ["all", ["==", "mode", "rail"], ["==", "fare", "covered"]], enabledModes);
    apply(
      "routes-light-rail",
      ["all", ["==", "mode", "light_rail"], ["==", "fare", "covered"]],
      enabledModes,
    );
    apply(
      "routes-light-rail-hit",
      ["all", ["==", "mode", "light_rail"], ["==", "fare", "covered"]],
      enabledModes,
    );
    apply("routes-ferry", ["all", ["==", "mode", "ferry"], ["==", "fare", "covered"]], enabledModes);
    apply(
      "routes-ferry-hit",
      ["all", ["==", "mode", "ferry"], ["==", "fare", "covered"]],
      enabledModes,
    );
    apply("routes-bus", ["all", ["==", "mode", "bus"], ["==", "fare", "covered"]], enabledModes);
    apply("routes-bus-hit", ["all", ["==", "mode", "bus"], ["==", "fare", "covered"]], enabledModes);
    apply("routes-extra", ["==", "fare", "extra"], null);
    apply("routes-extra-hit", ["==", "fare", "extra"], null);
    apply("stops-stations", ["!=", "isHub", true], enabledModes);
    apply("stops-hubs", ["==", "isHub", true], null);
    apply("stops-hub-labels", ["==", "isHub", true], null);

    const ringVisibility = showRings ? "visible" : "none";
    map.setLayoutProperty("distance-rings", "visibility", ringVisibility);
    map.setLayoutProperty("distance-ring-labels", "visibility", ringVisibility);

    if (map.getLayer("isochrone-fill")) {
      const showFill = duration !== ANYWHERE;
      const minutes = String(duration);
      map.setFilter("isochrone-fill", ["==", "minutes", minutes]);
      map.setFilter("isochrone-outline", ["==", "minutes", minutes]);
      map.setLayoutProperty("isochrone-fill", "visibility", showFill ? "visible" : "none");
      map.setLayoutProperty("isochrone-outline", "visibility", showFill ? "visible" : "none");
    }

    const fadeCovered =
      duration === ANYWHERE
        ? 0.9
        : ([
            "case",
            [">", ["to-number", ["get", "reachMin"]], duration],
            0.16,
            [">", ["to-number", ["get", "reachMax"]], duration],
            0.42,
            0.9,
          ] as never);
    for (const layer of [
      "routes-rail",
      "routes-light-rail",
      "routes-ferry",
      "routes-bus",
    ]) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, "line-opacity", fadeCovered);
    }
    const fadeStops =
      duration === ANYWHERE
        ? 1
        : ([
            "case",
            [">", ["to-number", ["get", "reachMin"]], duration],
            0.22,
            1,
          ] as never);
    if (map.getLayer("stops-stations")) {
      map.setPaintProperty("stops-stations", "circle-opacity", fadeStops);
    }
    if (map.getLayer("stops-hubs")) {
      map.setPaintProperty("stops-hubs", "circle-opacity", fadeStops);
    }
    const fadeDest =
      duration === ANYWHERE
        ? 1
        : ([
            "case",
            ["==", ["get", "fare"], "extra"],
            1,
            [">", ["to-number", ["get", "reachMin"]], duration],
            0.28,
            1,
          ] as never);
    if (map.getLayer("destinations-dot")) {
      map.setPaintProperty("destinations-dot", "circle-opacity", fadeDest);
      map.setPaintProperty("destinations-halo", "circle-opacity", fadeDest);
    }

    if (map.getLayer("destinations-dot")) {
      const categoryKeys = enabledDestinationCategories.length
        ? enabledDestinationCategories
        : ["__none__"];
      const destFilter = ["in", "category", ...categoryKeys] as FilterSpecification;
      const selectedId =
        selection?.type === "destination" ? selection.destination.id : "__none__";
      map.setFilter("destinations-halo", destFilter);
      map.setFilter("destinations-dot", destFilter);
      map.setFilter(
        "destinations-selected",
        ["all", destFilter, ["==", "destinationId", selectedId]] as FilterSpecification,
      );
      map.setFilter(
        "destinations-labels-major",
        [
          "all",
          destFilter,
          ["==", "showLabel", "yes"],
          ["==", "labelRank", "major"],
        ] as FilterSpecification,
      );
      map.setFilter(
        "destinations-labels-local",
        [
          "all",
          destFilter,
          ["==", "showLabel", "yes"],
          ["==", "labelRank", "local"],
        ] as FilterSpecification,
      );
      const destVisibility = showDestinations ? "visible" : "none";
      for (const layer of [
        "destinations-halo",
        "destinations-dot",
        "destinations-selected",
        "destinations-labels-major",
        "destinations-labels-local",
      ]) {
        map.setLayoutProperty(layer, "visibility", destVisibility);
      }
    }
  }, [
    enabledAgencies,
    enabledModes,
    connectedOnly,
    showRings,
    showDestinations,
    enabledDestinationCategories,
    selection,
    duration,
    hasData,
  ]);

  const focusDestination = (id: string) => {
    const destination = destinationById(id);
    if (!destination) return;
    setSelection(toDestinationSelection(destination, reachRef.current));
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    map.flyTo({
      center: [destination.longitude, destination.latitude],
      zoom: Math.max(map.getZoom(), 11.2),
      duration: 900,
      essential: true,
    });
  };

  return (
    <div className="relative h-dvh w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 z-10">
        <NetworkFilters
          enabledModes={enabledModes}
          enabledAgencies={enabledAgencies}
          showRings={showRings}
          connectedOnly={connectedOnly}
          showDestinations={showDestinations}
          enabledDestinationCategories={enabledDestinationCategories}
          duration={duration}
          onToggleMode={(mode) =>
            setEnabledModes((current) =>
              current.includes(mode)
                ? current.filter((item) => item !== mode)
                : [...current, mode],
            )
          }
          onToggleAgency={(agencyKey) =>
            setEnabledAgencies((current) =>
              current.includes(agencyKey)
                ? current.filter((item) => item !== agencyKey)
                : [...current, agencyKey],
            )
          }
          onToggleRings={() => setShowRings((value) => !value)}
          onToggleConnected={() => setConnectedOnly((value) => !value)}
          onToggleDestinations={() => setShowDestinations((value) => !value)}
          onToggleDestinationCategory={(category) =>
            setEnabledDestinationCategories((current) =>
              current.includes(category)
                ? current.filter((item) => item !== category)
                : [...current, category],
            )
          }
          onSelectDestination={focusDestination}
          onSelectDuration={setDuration}
        />
        <SelectionSheet
          selection={selection}
          hasData={hasData}
          error={error}
          duration={duration}
        />
      </div>
    </div>
  );
}
