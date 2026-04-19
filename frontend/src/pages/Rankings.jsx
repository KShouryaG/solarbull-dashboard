import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePlants } from "../context/PlantContext.jsx";
import { GradeBadge, StatusBadge } from "../components/Badge.jsx";
import { fmtDec, fmtPct, fmt } from "../utils/format.js";
import { GRADE_COLORS, GRADE_BG, BENCHMARKS } from "../utils/computed.js";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";

const SORT_OPTIONS = [
  { key: "performanceRatio", label: "Performance Ratio (PR)" },
  { key: "specificYield",    label: "Specific Yield (kWh/kWp)" },
  { key: "capacityFactor",   label: "Capacity Factor (%)" },
  { key: "todayEnergy",      label: "Today's Generation (kWh)" },
  { key: "totalEnergy",      label: "Lifetime Energy (kWh)" },
  { key: "capacity",         label: "Capacity (kWp)" },
];

export default function Rankings() {
  const navigate     = useNavigate();
  const { plants, loading, fetchPlants } = usePlants();
  const [sortBy,  setSortBy]  = useState("performanceRatio");
  const [customBenchmark, setCustomBenchmark] = useState("");

  useEffect(() => { fetchPlants(); }, []);

  const sorted = useMemo(() => {
    return [...plants].sort((a, b) => (b[sortBy] ?? -1) - (a[sortBy] ?? -1));
  }, [plants, sortBy]);

  const top12 = sorted.slice(0, 12);

  const benchmark = customBenchmark ? parseFloat(customBenchmark) : (
    sortBy === "performanceRatio" ? BENCHMARKS.pr.good * 100 :
    sortBy === "specificYield"   ? BENCHMARKS.specificYield.good :
    sortBy === "capacityFactor"  ? 25 : null
  );

  const getVal = (p) => {
    const v = p[sortBy];
    if (v === null || v === undefined) return null;
    if (sortBy === "performanceRatio" || sortBy === "capacityFactor") return +(v * (sortBy === "performanceRatio" ? 100 : 1)).toFixed(2);
    return v;
  };

  const fmtVal = (p) => {
    const v = p[sortBy];
    if (v === null || v === undefined) return "—";
    if (sortBy === "performanceRatio") return fmtPct(v);
    if (sortBy === "specificYield")    return `${fmtDec(v)} kWh/kWp`;
    if (sortBy === "capacityFactor")   return `${fmtDec(v)}%`;
    if (sortBy === "capacity")         return `${fmtDec(v)} kWp`;
    return `${fmt(v)} kWh`;
  };

  const chartData = top12.map((p) => ({
    name:  p.name.split(" ").slice(-2).join(" "),
    value: getVal(p),
    grade: p.grade || "N/A",
    id:    p.id,
  }));

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Plant Rankings</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Rank and color-grade your fleet by key performance indicators
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto", fontWeight: 500 }}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input
            value={customBenchmark}
            onChange={(e) => setCustomBenchmark(e.target.value)}
            placeholder="Set benchmark..."
            style={{ width: 140 }}
          />
        </div>
      </div>

      {/* Grade legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {["Excellent", "Good", "Fair", "Poor"].map((g) => (
          <div key={g} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: GRADE_COLORS[g] }} />
            <span style={{ color: GRADE_COLORS[g], fontWeight: 600 }}>{g}</span>
            {g === "Excellent" && <span style={{ color: "var(--color-text-tertiary)" }}>(PR ≥ {BENCHMARKS.pr.excellent*100}%)</span>}
            {g === "Good"      && <span style={{ color: "var(--color-text-tertiary)" }}>(PR ≥ {BENCHMARKS.pr.good*100}%)</span>}
            {g === "Fair"      && <span style={{ color: "var(--color-text-tertiary)" }}>(PR ≥ {BENCHMARKS.pr.fair*100}%)</span>}
            {g === "Poor"      && <span style={{ color: "var(--color-text-tertiary)" }}>(PR &lt; {BENCHMARKS.pr.fair*100}%)</span>}
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {!loading && chartData.length > 0 && (
        <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Top 12 Plants — {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => [v, SORT_OPTIONS.find((o) => o.key === sortBy)?.label]} />
              {benchmark && <ReferenceLine y={benchmark} stroke="var(--sb-blue)" strokeDasharray="4 4" label={{ value: `Benchmark: ${benchmark}`, fill: "var(--sb-blue)", fontSize: 11 }} />}
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={GRADE_COLORS[d.grade] || "#ccc"} cursor="pointer"
                    onClick={() => navigate(`/plants/${d.id}`)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Rankings table */}
      <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {["#", "Plant", "Status", "Capacity", SORT_OPTIONS.find((o) => o.key === sortBy)?.label, "Grade", "Today (kWh)"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "12px 14px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>Loading...</td></tr>
            ) : sorted.map((p, i) => (
              <tr key={p.id}
                onClick={() => navigate(`/plants/${p.id}`)}
                style={{ borderTop: "1px solid var(--color-border-light)", cursor: "pointer", borderLeft: `4px solid ${GRADE_COLORS[p.grade] || "transparent"}` }}
                onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                onMouseOut={(e)  => e.currentTarget.style.background = ""}>
                <td style={{ padding: "12px 14px", fontWeight: 700, color: "var(--color-text-secondary)", fontSize: 12 }}>#{i + 1}</td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{p.devices?.[0]?.model || "Sungrow"}</div>
                </td>
                <td style={{ padding: "12px 14px" }}><StatusBadge status={p.status} /></td>
                <td style={{ padding: "12px 14px" }}>{fmtDec(p.capacity)} kWp</td>
                <td style={{ padding: "12px 14px", fontWeight: 600, color: GRADE_COLORS[p.grade] }}>
                  {fmtVal(p)}
                  {benchmark && getVal(p) !== null && (
                    <span style={{ fontSize: 10, marginLeft: 6, color: getVal(p) >= benchmark ? "var(--color-grade-excellent)" : "var(--color-text-danger)" }}>
                      {getVal(p) >= benchmark ? "▲" : "▼"}
                    </span>
                  )}
                </td>
                <td style={{ padding: "12px 14px" }}><GradeBadge grade={p.grade} /></td>
                <td style={{ padding: "12px 14px" }}>{fmt(p.todayEnergy)} kWh</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
