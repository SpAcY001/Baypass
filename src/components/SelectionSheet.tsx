import type { ReactNode } from "react";
import { agencyByKey } from "@/lib/coverage";
import { formatMiles, transitDirectionsUrl } from "@/lib/destinations";
import {
  ANYWHERE,
  ISOCHRONE_DEPARTURE_LABEL,
  formatReachMinutes,
  type DurationChoice,
} from "@/lib/isochrone";
import type { Selection } from "@/lib/types";

function CoverageBadge({ covered }: { covered: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        covered ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
      }`}
    >
      {covered ? "Covered by BayPass" : "Additional fare required"}
    </span>
  );
}

function modeLabel(mode: string): string {
  if (mode === "light_rail") return "light rail";
  return mode;
}

export default function SelectionSheet({
  selection,
  hasData,
  error,
  duration,
}: {
  selection: Selection;
  hasData: boolean;
  error: string | null;
  duration: DurationChoice;
}) {
  let title = "BayPass network";
  let body: ReactNode = (
    <>
      <CoverageBadge covered />
      <p className="mt-2 text-sm leading-6 text-stone-600">
        SJSU BayPass covers 24 agencies from campus outward. Rings are miles from
        SJSU, not a fare boundary. Dashed amber is a paid connection.
      </p>
      <p className="mt-2 text-sm text-stone-500">
        {duration === ANYWHERE
          ? "The time chips show how far covered transit goes on a weekday morning. Santa Cruz is closer than San Francisco in miles, but it stays outside the fill."
          : `The blue fill is about how far covered transit goes in ${
              duration < 60 ? `${duration} minutes` : `${duration / 60} hour${duration > 60 ? "s" : ""}`
            } from campus (${ISOCHRONE_DEPARTURE_LABEL}). Faded lines are still on BayPass, just farther than that.`}
      </p>
    </>
  );

  if (error) {
    title = "Network data missing";
    body = <p className="text-sm leading-6 text-stone-600">{error}</p>;
  } else if (!hasData) {
    title = "Loading network";
    body = <p className="text-sm text-stone-500">Drawing BayPass routes from GTFS…</p>;
  } else if (selection?.type === "origin") {
    title = "San José State University";
    body = (
      <p className="text-sm leading-6 text-stone-600">
        Origin for this map. VTA serves campus. Walk or ride to Diridon for
        Caltrain and Highway 17 Express, or to Berryessa for BART.
      </p>
    );
  } else if (selection?.type === "gap") {
    title = "Outside convenient BayPass reach";
    body = (
      <>
        <CoverageBadge covered={false} />
        <p className="mt-2 text-sm leading-6 text-stone-600">
          No BayPass-covered transit reaches this spot conveniently. Nearest
          mapped stop: {selection.nearestName} ({selection.distanceMiles.toFixed(1)}{" "}
          miles).
        </p>
        {selection.extraFareHint ? (
          <p className="mt-2 text-sm leading-6 text-stone-600">{selection.extraFareHint}</p>
        ) : null}
      </>
    );
  } else if (selection?.type === "route") {
    const route = selection.properties;
    const agency = agencyByKey(route.agencyKey);
    title = route.routeShortName || route.routeLongName || route.agencyName;
    body = (
      <>
        <CoverageBadge covered={route.covered} />
        <p className="mt-2 text-sm text-stone-500">
          {route.agencyName} · {modeLabel(route.mode)}
        </p>
        {route.routeLongName && route.routeLongName !== route.routeShortName ? (
          <p className="mt-1 text-sm text-stone-500">{route.routeLongName}</p>
        ) : null}
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {route.covered
            ? (agency?.connectHint ?? `${route.agencyName} is covered by BayPass.`)
            : (agency?.connectHint ??
              "BayPass does not cover this ride. Pay a separate fare.")}
        </p>
        {route.covered && duration !== ANYWHERE && route.reachMin != null ? (
          <p className="mt-2 text-sm leading-6 text-stone-500">
            {route.reachMin > duration
              ? `Most of this line is outside the ${duration}-minute range (${ISOCHRONE_DEPARTURE_LABEL}).`
              : route.reachMax != null && route.reachMax > duration
                ? `The near end is within ${duration} minutes of campus; farther stops take longer.`
                : `Reachable from campus within ${duration} minutes (${ISOCHRONE_DEPARTURE_LABEL}).`}
          </p>
        ) : null}
        {!route.connected ? (
          <p className="mt-2 text-sm leading-6 text-stone-500">
            This line does not pass San José. Reach it with a BayPass transfer
            elsewhere, or turn off “Connected from San José” to browse the
            rest of the network.
          </p>
        ) : null}
      </>
    );
  } else if (selection?.type === "station") {
    const stop = selection.properties;
    const agency = agencyByKey(stop.agencyKey);
    title = stop.stopName;
    body = (
      <>
        <CoverageBadge covered={stop.covered} />
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {stop.covered
            ? `${stop.agencyName} is covered by BayPass${
                stop.isHub ? ". Major transfer hub for SJSU riders." : "."
              }`
            : `${stop.agencyName} is outside BayPass. Boarding here needs another fare.`}
        </p>
        {agency?.connectHint ? (
          <p className="mt-1 text-sm text-stone-500">{agency.connectHint}</p>
        ) : null}
        {stop.covered && duration !== ANYWHERE && stop.reachMin != null ? (
          <p className="mt-2 text-sm leading-6 text-stone-500">
            {stop.reachMin > duration
              ? `Outside the ${duration}-minute range from campus (${ISOCHRONE_DEPARTURE_LABEL}).`
              : `${formatReachMinutes(stop.reachMin)} from campus (${ISOCHRONE_DEPARTURE_LABEL}).`}
          </p>
        ) : null}
      </>
    );
  } else if (selection?.type === "destination") {
    const { destination, milesFromSjsu, walkMiles, reachMinutes } = selection;
    title = destination.name;
    body = (
      <>
        <CoverageBadge covered={destination.covered} />
        <p className="mt-2 text-sm text-stone-500">
          {formatMiles(milesFromSjsu)} from SJSU
          {walkMiles !== null
            ? ` · ${
                walkMiles < 0.08
                  ? `at ${destination.nearbyStopName}`
                  : `${formatMiles(walkMiles)} walk from ${destination.nearbyStopName}`
              }`
            : ` · ${destination.nearbyStopName}`}
        </p>
        {reachMinutes != null ? (
          <p className="mt-1 text-sm text-stone-500">
            {formatReachMinutes(reachMinutes)} on covered transit ({ISOCHRONE_DEPARTURE_LABEL})
          </p>
        ) : reachMinutes === null ? (
          <p className="mt-1 text-sm text-stone-500">
            Not on the covered-morning isochrone. Extra fare or a last-mile the
            router does not model.
          </p>
        ) : null}
        {duration !== ANYWHERE && reachMinutes != null && reachMinutes > duration ? (
          <p className="mt-1 text-sm text-amber-800">
            Outside the selected {duration}-minute range.
          </p>
        ) : null}
        <p className="mt-1 text-sm text-stone-500">{destination.connectVia}</p>
        <p className="mt-2 text-sm leading-6 text-stone-600">{destination.how}</p>
        <a
          href={transitDirectionsUrl(destination)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex text-sm font-medium text-sky-800 underline decoration-sky-800/30 underline-offset-2 hover:text-sky-950"
        >
          Transit directions
        </a>
      </>
    );
  }

  return (
    <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto max-w-xl rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg shadow-stone-900/10 backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          {selection?.type === "destination" ? "Trip from campus" : "BayPass network"}
        </p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-stone-900">
          {title}
        </h1>
        <div className="mt-2">{body}</div>
      </div>
    </section>
  );
}
