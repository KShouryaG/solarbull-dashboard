import { useState, useEffect, useMemo } from "react";
import { usePlants } from "../context/PlantContext.jsx";
import { GradeBadge, StatusBadge } from "../components/Badge.jsx";
import { fmt, fmtDec, fmtPct, rupee } from "../utils/format.js";
import { GRADE_COLORS } from "../utils/computed.js";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";

const CHART_PALETTE = ["#F7941D", "#1E5BA6", "#0E9B65", "#8B5CF6", "#DC2626", "#0891B2"];

// Haversine distance in km
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function Compare() {
  const { plants: allPlants, loading, fetchPlants } = usePlants();
  const [selected,    setSelected]    = useState([]);
  const [search,      setSearch]      = useState("");
  const [geoMode,     setGeoMode]     = useState("none"); // none | city | radius
  const [geoCity,     setGeoCity]     = useState("");
  const [geoRadius,   setGeoRadius]   = useState("50");
  const [geoRef,      setGeoRef]      = useState("");  // reference plant id for radius

  useEffect(() => { fetchPlants(); }, []);

  const plants = allPlants.filter((p) => selected.includes(p.id));

  const cities = useMemo(() => [...new Set(allPlants.map((p) => p.city).filter(Boolean))].sort(), [allPlants]);

  const filtered = useMemo(() => {
    let f = allPlants;
    if (search)               f = f.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (geoMode === "city" && geoCity)    f = f.filter((p) => (p.city||"").toLowerCase().includes(geoCity.toLowerCase()));
    if (geoMode === "radius" && geoRef) {
      const ref = allPlants.find((p) => p.id === geoRef);
      if (ref && ref.latitude && ref.longitude) {
        const km = parseFloat(geoRadius) || 50;
        f = f.filter((p) => {
          if (!p.latitude || !p.longitude) return false;
          return haversine(parseFloat(ref.latitude), parseFloat(ref.longitude), parseFloat(p.latitude), parseFloat(p.longitude)) <= km;
        });
      }
    }
    return f;
  }, [allPlants, search, geoMode, geoCity, geoRef, geoRadius]);

  const toggle = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 6 ? [...prev, id] : prev
    );
  };

  // Radar data: normalise per plant
  const radarData = [
    { metric: "PR",        key: "performanceRatio",  max: 1.0   },
    { metric: "CF%",       key: "capacityFactor",    max: 25    },
    { metric: "Yield",     key: "specificYield",     max: 8     },
    { metric: "Capacity",  key: "capacity",          max: Math.max(...allPlants.map((p) => p.capacity || 0)) || 1000 },
    { metric: "Today kWh", key: "todayEnergy",       max: Math.max(...allPlants.map((p) => p.todayEnergy || 0)) || 1000 },
  ].map((def) => {
    const row = { metric: def.metric };
    plants.forEach((p) => {
      const raw = p[def.key] ?? 0;
      row[p.id] = Math.min(100, (raw / def.max) * 100);
    });
    return row;
  });

  // Bar chart: energy comparison
  const energyData = [
    { metric: "Today (kWh)",    key: "todayEnergy"   },
    { metric: "Total (MWh)",    key: "totalEnergy",    divisor: 1000 },
  ].map((def) => {
    const row = { metric: def.metric };
    plants.forEach((p) => {
      row[p.id] = def.divisor ? parseFloat(((p[def.key] || 0) / def.divisor).toFixed(1)) : (p[def.key] || 0);
    });
    return row;
  });

  const metricRows = [
    { label: "Status",            render: (p) => <StatusBadge status={p.status} /> },
    { label: "Grade",             render: (p) => <GradeBadge grade={p.grade} /> },
    { label: "Capacity (kWp)",    render: (p) => fmtDec(p.capacity) },
    { label: "Live Power (kW)",   render: (p) => p.currentPower != null ? fmtDec(p.currentPower) : "—" },
    { label: "Today (kWh)",       render: (p) => fmt(p.todayEnergy) },
    { label: "This Month (kWh)",  render: (p) => p.monthEnergy != null ? fmt(p.monthEnergy) : "—" },
    { label: "Lifetime (MWh)",    render: (p) => fmt(parseFloat(((p.totalEnergy || 0) / 1000).toFixed(1))) },
    { label: "Performance Ratio", render: (p) => p.performanceRatio ? fmtPct(p.performanceRatio) : "—", highlight: true },
    { label: "Specific Yield",    render: (p) => p.specificYield ? `${fmtDec(p.specificYield)} kWh/kWp` : "—" },
    { label: "Capacity Factor",   render: (p) => p.capacityFactor ? `${fmtDec(p.capacityFactor)}%` : "—" },
    { label: "CO₂ Avoided (kg)",  render: (p) => fmt(Math.round(p.co2Avoided || p.co2 || 0)) },
    { label: "Revenue Today",     render: (p) => rupee(Math.round(p.revenueToday || 0)) },
    { label: "Active Alerts",     render: (p) => <span style={{ color: (p.errors?.length || 0) > 0 ? "#DC2626" : "#0E9B65", fontWeight: 600 }}>{p.errors?.length || 0}</span> },
    { label: "Location",          render: (p) => p.city || "—" },
    { label: "Install Date",      render: (p) => p.installDate || "—" },
  ];

  const bestPR = plants.reduce((best, p) =>
    (p.performanceRatio || 0) > (best?.performanceRatio || 0) ? p : best, null);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Left: plant selector */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 16, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Select Plants (max 6)</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              style={{ width: "100%", marginBottom: 10, fontSize: 12 }}
            />

            {/* Geographic filter */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Filter by Location</div>
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                {[["none","All"],["city","City"],["radius","Radius"]].map(([v,l]) => (
                  <button key={v} onClick={() => setGeoMode(v)} style={{ flex: 1, fontSize: 10, padding: "4px 0", background: geoMode === v ? "var(--sb-blue)" : "var(--color-background-secondary)", color: geoMode === v ? "#fff" : "var(--color-text-secondary)", border: "none", borderRadius: 4, fontWeight: 500 }}>{l}</button>
                ))}
              </div>
              {geoMode === "city" && (
                <input value={geoCity} onChange={(e) => setGeoCity(e.target.value)} placeholder="City name…" style={{ fontSize: 11, marginBottom: 4 }} list="cmp-cities" />
              )}
              {geoMode === "radius" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <select value={geoRef} onChange={(e) => setGeoRef(e.target.value)} style={{ fontSize: 11 }}>
                    <option value="">Reference plant…</option>
                    {allPlants.filter((p) => p.latitude && p.longitude).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" value={geoRadius} onChange={(e) => setGeoRadius(e.target.value)} style={{ fontSize: 11, width: "70px" }} min="1" max="500" />
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>km radius</span>
                  </div>
                </div>
              )}
              <datalist id="cmp-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
              {(geoMode !== "none") && <div style={{ fontSize: 10, color: "var(--sb-blue)", marginTop: 4 }}>{filtered.length} plants in range</div>}
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: 20, color: "var(--color-text-tertiary)" }}>Loading…</div>
            ) : (
              <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
                {filtered.map((p) => {
                  const isSelected = selected.includes(p.id);
                  const idx = selected.indexOf(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      style={{
                        padding: "8px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 4,
                        background: isSelected ? CHART_PALETTE[idx] + "15" : "transparent",
                        border: `1px solid ${isSelected ? CHART_PALETTE[idx] : "transparent"}`,
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        background: isSelected ? CHART_PALETTE[idx] : "var(--color-background-secondary)",
                        border: `2px solid ${isSelected ? CHART_PALETTE[idx] : "var(--color-border-light)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {isSelected && <div style={{ width: 6, height: 6, borderRadius: 1, background: "#fff" }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: GRADE_COLORS[p.grade] }}>{p.grade} · {p.status}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {selected.length > 0 && (
              <button onClick={() => setSelected([])} style={{ marginTop: 10, width: "100%", fontSize: 11, padding: "6px 0", background: "transparent", border: "1px solid var(--color-border-light)", color: "var(--color-text-secondary)", borderRadius: 6 }}>
                Clear selection
              </button>
            )}
          </div>
        </div>

        {/* Right: comparison view */}
        <div style={{ flex: 1 }}>
          {plants.length < 2 ? (
            <div style={{ padding: 60, textAlign: "center", color: "var(--color-text-tertiary)", background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "1px solid var(--color-border-light)" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚖</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Select 2–6 plants to compare</div>
              <div style={{ fontSize: 13 }}>Pick plants from the list on the left</div>
            </div>
          ) : (
            <>
              {/* Best performer banner */}
              {bestPR && (
                <div style={{ background: "#E8F8F1", border: "1px solid #0E9B65", borderRadius: 8, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ fontSize: 20 }}>🏆</span>
                  <span><strong>{bestPR.name}</strong> leads with PR of <strong style={{ color: "#0E9B65" }}>{fmtPct(bestPR.performanceRatio)}</strong></span>
                </div>
              )}

              {/* Metrics table */}
              <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", overflow: "hidden", marginBottom: 20 }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "var(--color-background-secondary)" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap", minWidth: 130 }}>Metric</th>
                        {plants.map((p, i) => (
                          <th key={p.id} style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, fontSize: 11, color: CHART_PALETTE[i], whiteSpace: "nowrap", borderLeft: `2px solid ${CHART_PALETTE[i]}30` }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{p.name.split(" ").slice(-2).join(" ")}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metricRows.map(({ label, render, highlight }) => {
                        // Find best value for PR highlight
                        const vals = highlight
                          ? plants.map((p) => p.performanceRatio || 0)
                          : null;
                        const maxVal = vals ? Math.max(...vals) : null;
                        return (
                          <tr key={label} style={{ borderTop: "1px solid var(--color-border-light)" }}>
                            <td style={{ padding: "10px 16px", color: "var(--color-text-secondary)", fontWeight: 500 }}>{label}</td>
                            {plants.map((p, i) => {
                              const isMax = highlight && (p.performanceRatio || 0) === maxVal && maxVal > 0;
                              return (
                                <td key={p.id} style={{
                                  padding: "10px 16px", textAlign: "center",
                                  fontWeight: isMax ? 700 : 500,
                                  background: isMax ? "#E8F8F1" : "transparent",
                                  borderLeft: `2px solid ${CHART_PALETTE[i]}30`,
                                }}>
                                  {render(p)}
                                  {isMax && <span style={{ marginLeft: 4, fontSize: 11 }}>★</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charts */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* Radar */}
                <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Performance Profile (normalised)</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={90}>
                      <PolarGrid stroke="var(--color-border-light)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                      {plants.map((p, i) => (
                        <Radar key={p.id} name={p.name.split(" ").slice(-2).join(" ")} dataKey={p.id} stroke={CHART_PALETTE[i]} fill={CHART_PALETTE[i]} fillOpacity={0.15} strokeWidth={2} />
                      ))}
                      <Legend iconType="circle" iconSize={10} />
                      <Tooltip formatter={(v) => [`${v.toFixed(0)}%`, ""]} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Energy bar */}
                <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Energy Comparison</div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={energyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                      <XAxis dataKey="metric" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Legend iconType="square" iconSize={10} />
                      {plants.map((p, i) => (
                        <Bar key={p.id} dataKey={p.id} name={p.name.split(" ").slice(-2).join(" ")} fill={CHART_PALETTE[i]} radius={[3, 3, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
