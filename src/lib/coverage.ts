import coverage from "../../data/coverage.json";

export type TransitMode = "rail" | "light_rail" | "bus" | "ferry";

export type CoverageAgency = {
  name: string;
  covered: boolean;
  exceptions: string[];
  gtfsIds: string[];
  gtfsUrl?: string;
  color: string;
  defaultOn: boolean;
  connectHint: string;
};

export type CoverageConfig = {
  version: number;
  agencies: Record<string, CoverageAgency>;
};

export const coverageConfig = coverage as CoverageConfig;

export const agencyEntries = Object.entries(coverageConfig.agencies);

export function coverageForAgencyId(agencyId: string): {
  key: string;
  agency: CoverageAgency;
} | null {
  const direct = coverageConfig.agencies[agencyId];
  if (direct) return { key: agencyId, agency: direct };

  for (const [key, agency] of agencyEntries) {
    if (agency.gtfsIds.includes(agencyId)) {
      return { key, agency };
    }
  }

  return null;
}

export function isAgencyCovered(agencyId: string): boolean {
  return coverageForAgencyId(agencyId)?.agency.covered ?? false;
}

export function defaultEnabledAgencies(): string[] {
  return agencyEntries.filter(([, agency]) => agency.defaultOn).map(([key]) => key);
}

export function agencyByKey(key: string): CoverageAgency | null {
  return coverageConfig.agencies[key] ?? null;
}

export function primaryAgencies() {
  return agencyEntries.filter(([, agency]) => agency.covered && agency.defaultOn);
}

export function extraFareAgencies() {
  return agencyEntries.filter(([, agency]) => !agency.covered);
}

export function moreAgencies() {
  return agencyEntries.filter(([, agency]) => agency.covered && !agency.defaultOn);
}
