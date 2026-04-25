export const PEAK_SUN_HOURS = 5.5;
export const TARIFF = 4.5;
export const CO2_FACTOR = 0.82;

// India-context benchmarks
export const BENCHMARKS = {
  pr:            { excellent: 0.80, good: 0.70, fair: 0.55 },
  specificYield: { excellent: 4.5,  good: 3.5,  fair: 2.5  }, // kWh/kWp/day (matches server SY_EXCELLENT/GOOD/FAIR)
  availability:  { excellent: 0.98, good: 0.95, fair: 0.90 },
  panelEff:      { typical: 0.22,   range: "22–24%" },
  inverterEff:   { typical: 0.97,   range: "97–99%" },
  degradation:   0.005,   // 0.5%/yr
  lcoe:          0.043,   // $/kWh by 2024 (IRENA)
  acresPerMW:    32,       // NREL estimate
};

export const GRADE_COLORS = {
  Excellent: "#0E9B65",
  Good:      "#1E5BA6",
  Fair:      "#F7941D",
  Poor:      "#DC2626",
  "N/A":     "#9CA3AF",
};

export const GRADE_BG = {
  Excellent: "#E8F8F1",
  Good:      "#EBF2FC",
  Fair:      "#FFF3E0",
  Poor:      "#FEF0F0",
  "N/A":     "#F3F4F6",
};

export function gradeFromPR(pr) {
  if (pr === null || pr === undefined) return "N/A";
  if (pr >= BENCHMARKS.pr.excellent)  return "Excellent";
  if (pr >= BENCHMARKS.pr.good)       return "Good";
  if (pr >= BENCHMARKS.pr.fair)       return "Fair";
  return "Poor";
}

export function gradeFromSY(sy) {
  if (sy === null || sy === undefined) return "N/A";
  if (sy >= BENCHMARKS.specificYield.excellent) return "Excellent";
  if (sy >= BENCHMARKS.specificYield.good)      return "Good";
  if (sy >= BENCHMARKS.specificYield.fair)      return "Fair";
  return "Poor";
}

export function specificYield(todayEnergy, capacity) {
  return capacity > 0 ? +(todayEnergy / capacity).toFixed(3) : null;
}

export function performanceRatio(sy) {
  return sy !== null && sy !== undefined ? +(sy / PEAK_SUN_HOURS).toFixed(3) : null;
}

export function capacityFactor(todayEnergy, capacity) {
  return capacity > 0 ? +((todayEnergy / (capacity * 24)) * 100).toFixed(2) : null;
}

/** Estimated years of operation from install date */
export function plantAge(installDate) {
  if (!installDate) return null;
  const diff = Date.now() - new Date(installDate).getTime();
  return +(diff / (365.25 * 24 * 3600 * 1000)).toFixed(1);
}

/** Estimated degraded capacity (0.5%/yr) */
export function degradedCapacity(capacity, ageYears) {
  if (!capacity || !ageYears) return capacity;
  return +(capacity * Math.pow(1 - BENCHMARKS.degradation, ageYears)).toFixed(2);
}
