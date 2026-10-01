"use client";

import { useState } from "react";
import { extraFareAgencies, moreAgencies, primaryAgencies } from "@/lib/coverage";
import { destinationCategories, destinations } from "@/lib/destinations";
import { DURATION_OPTIONS, ISOCHRONE_DEPARTURE_LABEL } from "@/lib/isochrone";
import { MODES, SJSU_GOLD } from "@/lib/constants";
import type { TransitMode } from "@/lib/coverage";
import type { DurationChoice } from "@/lib/isochrone";
import type { DestinationCategory } from "@/lib/types";

function AgencyRow({
  agencyKey,
  name,
  color,
  checked,
  extraFare,
  onToggle,
}: {
  agencyKey: string;
  name: string;
  color: string;
  checked: boolean;
  extraFare?: boolean;
  onToggle: (agencyKey: string) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-stone-800 hover:bg-stone-50">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(agencyKey)}
          className="size-3.5"
          style={{ accentColor: color }}
        />
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{
            backgroundColor: extraFare ? "transparent" : color,
            boxShadow: extraFare ? `inset 0 0 0 1.5px ${color}` : undefined,
          }}
        />
        <span>{name}</span>
        {extraFare ? (
          <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-amber-700">
            Extra fare
          </span>
        ) : null}
      </label>
    </li>
  );
}

export default function NetworkFilters({
  enabledModes,
  enabledAgencies,
  showRings,
  connectedOnly,
  showDestinations,
  enabledDestinationCategories,
  duration,
  onToggleMode,
  onToggleAgency,
  onToggleRings,
  onToggleConnected,
  onToggleDestinations,
  onToggleDestinationCategory,
  onSelectDestination,
  onSelectDuration,
}: {
  enabledModes: TransitMode[];
  enabledAgencies: string[];
  showRings: boolean;
  connectedOnly: boolean;
  showDestinations: boolean;
  enabledDestinationCategories: DestinationCategory[];
  duration: DurationChoice;
  onToggleMode: (mode: TransitMode) => void;
  onToggleAgency: (agencyKey: string) => void;
  onToggleRings: () => void;
  onToggleConnected: () => void;
  onToggleDestinations: () => void;
  onToggleDestinationCategory: (category: DestinationCategory) => void;
  onSelectDestination: (id: string) => void;
  onSelectDuration: (duration: DurationChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tripsOpen, setTripsOpen] = useState(false);
  const primary = primaryAgencies();
  const extraFare = extraFareAgencies();
  const extra = moreAgencies();
  const tripList = destinations
    .filter((destination) =>
      (enabledDestinationCategories ?? []).includes(destination.category),
    )
    .slice()
    .sort((a, b) => Number(a.covered) - Number(b.covered));

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 w-[min(100%-1.5rem,18.5rem)] space-y-2 sm:left-4 sm:top-4">
      <div className="rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-sm shadow-stone-900/10 backdrop-blur">
        <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          From campus
        </p>
        <div className="flex flex-wrap gap-1">
          {DURATION_OPTIONS.map((option) => {
            const on = duration === option.id;
            return (
              <button
                key={String(option.id)}
                type="button"
                onClick={() => onSelectDuration(option.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  on ? "bg-sky-900 text-white" : "bg-stone-100 text-stone-500"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 px-1.5 text-[11px] leading-4 text-stone-400">
          {ISOCHRONE_DEPARTURE_LABEL}. Blue fill is covered transit, not Highway 17.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-sm shadow-stone-900/10 backdrop-blur">
        {MODES.map((mode) => {
          const on = enabledModes.includes(mode.id);
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onToggleMode(mode.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                on ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-sm shadow-stone-900/10 backdrop-blur">
        <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          From SJSU
        </p>
        <ul className="space-y-0.5">
          <li>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-stone-800 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={connectedOnly}
                onChange={onToggleConnected}
                className="size-3.5 accent-stone-800"
              />
              Connected from San José
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-stone-800 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={showRings}
                onChange={onToggleRings}
                className="size-3.5 accent-stone-800"
              />
              Distance rings
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-stone-800 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={showDestinations}
                onChange={onToggleDestinations}
                className="size-3.5 accent-stone-800"
              />
              Destination pins
            </label>
          </li>
        </ul>
        {showDestinations ? (
          <div className="mt-1 flex flex-wrap gap-1 px-1">
            {destinationCategories.map((category) => {
              const on = enabledDestinationCategories.includes(category.id);
              const extraFareChip = category.id === "extra_fare";
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onToggleDestinationCategory(category.id)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    on
                      ? extraFareChip
                        ? "bg-amber-700 text-white"
                        : "bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {showDestinations ? (
          <>
            <button
              type="button"
              onClick={() => setTripsOpen((value) => !value)}
              className="mt-1 w-full rounded-lg px-1.5 py-1 text-left text-xs font-medium text-stone-500 hover:bg-stone-50"
            >
              {tripsOpen ? "Hide trips" : `Trips from campus (${tripList.length})`}
            </button>
            {tripsOpen ? (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {tripList.map((destination) => (
                  <li key={destination.id}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        onSelectDestination(destination.id);
                        setTripsOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm text-stone-800 hover:bg-stone-50"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: destination.covered ? SJSU_GOLD : "transparent",
                          boxShadow: destination.covered
                            ? undefined
                            : "inset 0 0 0 1.5px #D97706",
                        }}
                      />
                      <span className="truncate">{destination.shortName}</span>
                      {!destination.covered ? (
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-amber-700">
                          Extra fare
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        <p className="mt-2 px-1.5 text-[11px] leading-4 text-stone-400">
          Solid lines are BayPass. Dashed amber needs another fare. Faded lines sit
          outside the selected time. Gold pins are curated trips.
        </p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-sm shadow-stone-900/10 backdrop-blur">
        <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Agencies
        </p>
        <ul className="space-y-0.5">
          {primary.map(([key, agency]) => (
            <AgencyRow
              key={key}
              agencyKey={key}
              name={agency.name}
              color={agency.color}
              checked={enabledAgencies.includes(key)}
              onToggle={onToggleAgency}
            />
          ))}
        </ul>
        {extraFare.length ? (
          <ul className="mt-1 space-y-0.5 border-t border-stone-100 pt-1">
            {extraFare.map(([key, agency]) => (
              <AgencyRow
                key={key}
                agencyKey={key}
                name={agency.name}
                color={agency.color}
                checked={enabledAgencies.includes(key)}
                extraFare
                onToggle={onToggleAgency}
              />
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 w-full rounded-lg px-1.5 py-1 text-left text-xs font-medium text-stone-500 hover:bg-stone-50"
        >
          {open ? "Hide other agencies" : `More agencies (${extra.length})`}
        </button>
        {open ? (
          <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
            {extra.map(([key, agency]) => (
              <AgencyRow
                key={key}
                agencyKey={key}
                name={agency.name}
                color={agency.color}
                checked={enabledAgencies.includes(key)}
                onToggle={onToggleAgency}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
