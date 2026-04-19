import { useState, useEffect, useMemo } from "react";
import { getFleetAnalytics } from "../api.js";
import MetricCard from "../components/MetricCard.jsx";
import { fmt, fmtPct, rupee, fmtDec } from "../utils/format.js";
import { GRADE_COLORS } from "../utils/computed.js";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, Cell,
} from "recharts";

const RANGES = [
  { value: "7d",  label: "7 Days"  },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "3 Months" },
  { value: "1y",  label: "1 Year"  },
];

const CHART_COLORS = { energy: "#F7941D", pr: "#1E5BA6", revenue: "#0E9B65", online: "#8B5CF6" };

function Card({ title, children }) {
  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "var(--color-text-primary)" }}>{title}</div>
      {children}
    </div>
  );
}

export default function Analytics() {
  const [range,     setRange]     = useState("30d");
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [metric,    setMetric]    = useState("energy");

  const load = async (r) => {
    setLoading(true);
    try {
      const d = await getFleetAnalytics(r);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(range); }, [range]);

  const timeline = data?.timeline || [];

  // Downsample for 1y (show weekly averages)
  const chartData = useMemo(() => {
    if (range !== "1y" || timeline.length <= 52) return timeline;
    // Group into weeks
    const weeks = [];
    for (let i = 0; i < timeline.length; i += 7) {
      const chunk = timeline.slice(i, i + 7);
      weeks.push({
        date:        chunk[0].date,
        totalEnergy: Math.round(chunk.reduce((s, x) => s + x.totalEnergy, 0) / chunk.length),
        avgPR:       parseFloat((chunk.reduce((s, x) => s + x.avgPR, 0) / chunk.length).toFixed(3)),
        revenue:     Math.round(chunk.reduce((s, x) => s + x.revenue, 0) / chunk.length),
        online:      Math.round(chunk.reduce((s, x) => s + x.online, 0) / chunk.length),
      });
    }
    return weeks;
  }, [timeline, range]);

  // Cumulative energy
  const cumulativeData = useMemo(() => {
    let cum = 0;
    return chartData.map((d) => ({ ...d, cumEnergy: (cum += d.totalEnergy) }));
  }, [chartData]);

  // Tick formatter
  const dateFmt = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (range === "7d")  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    if (range === "30d") return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    if (range === "90d") return dt.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
    return dt.toLocaleDateString("en-IN", { month: "short", day: "2-digit" });
  };

  const s = data?.summary;
  const gradeDist = data?.gradeDist || [];
  const prHist    = data?.prHistogram || [];
  const top5      = data?.top5 || [];
  const bottom5   = data?.bottom5 || [];

  const totalGenPeriod = timeline.reduce((s, d) => s + d.totalEnergy, 0);
  const totalRevPeriod = timeline.reduce((s, d) => s + d.revenue, 0);
  const co2Period      = timeline.reduce((s, d) => s + d.co2Avoided, 0);

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Fleet Analytics</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Trends, KPIs, and performance insights across your entire fleet
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--color-background-secondary)", padding: 4, borderRadius: 8 }}>
          {RANGES.map(({ value, label }) => (
            <button key={value} onClick={() => setRange(value)} style={{
              padding: "6px 14px", fontSize: 12, fontWeight: range === value ? 600 : 400,
              background: range === value ? "var(--color-background-primary)" : "transparent",
              color: range === value ? "var(--sb-blue)" : "var(--color-text-secondary)",
              border: range === value ? "1px solid var(--color-border-light)" : "none",
              borderRadius: 6, boxShadow: range === value ? "var(--shadow-sm)" : "none",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 80, color: "var(--color-text-tertiary)" }}>
          <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          Loading analytics…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 24 }}>
            <MetricCard label="Total Capacity"     value={`${fmt(Math.round(s?.totalCapacity))} kWp`} icon="⚡" sub={`${s?.totalPlants} plants`} />
            <MetricCard label={`Generation (${range})`} value={`${fmt(Math.round(totalGenPeriod))} kWh`} accent="var(--sb-orange)" icon="☀" sub="Fleet total" />
            <MetricCard label={`Revenue (${range})`}    value={rupee(Math.round(totalRevPeriod))}       accent="var(--color-grade-good)" icon="₹" sub="Est. earnings" />
            <MetricCard label={`CO₂ Saved (${range})`}  value={`${fmt(Math.round(co2Period))} kg`}      accent="#0E9B65" icon="🌿" sub={`${fmt(Math.round(co2Period/21))} trees equiv`} />
            <MetricCard label="Fleet Avg PR"       value={s?.avgPR ? fmtPct(s.avgPR) : "—"}          accent="var(--sb-blue)" icon="📊" sub="Performance ratio" />
            <MetricCard label="Online Now"         value={`${s?.online}/${s?.totalPlants}`}            accent="#0E9B65" icon="🏭" sub={`${s?.warning} warn · ${s?.offline} off`} />
            <MetricCard label="Active Alerts"      value={String(s?.totalAlerts || 0)}                 accent={s?.totalAlerts > 0 ? "var(--color-text-danger)" : undefined} icon="⚠" sub="Across fleet" />
            <MetricCard label="Est. Monthly Rev"   value={rupee(Math.round(s?.estimatedMonthly))}      icon="📅" sub="Based on today" />
          </div>

          {/* Charts grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

            {/* Energy trend */}
            <Card title="Daily Energy Generation (kWh)">
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["energy","kWh","#F7941D"],["revenue","Revenue","#0E9B65"],["online","Online Plants","#8B5CF6"]].map(([k, l, c]) => (
                  <button key={k} onClick={() => setMetric(k)} style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 999,
                    background: metric === k ? c + "20" : "transparent",
                    color: metric === k ? c : "var(--color-text-secondary)",
                    border: `1px solid ${metric === k ? c : "var(--color-border-light)"}`,
                    fontWeight: metric === k ? 600 : 400,
                  }}>
                    {l}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradEnergy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[metric] || "#F7941D"} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[metric] || "#F7941D"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={dateFmt} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => metric === "revenue" ? `₹${(v/1000).toFixed(0)}K` : metric === "online" ? `${v}` : `${(v/1000).toFixed(0)}K`} />
                  <Tooltip labelFormatter={dateFmt} formatter={(v) => metric === "revenue" ? [`₹${fmt(Math.round(v))}`, "Revenue"] : metric === "online" ? [`${v} plants`, "Online"] : [`${fmt(Math.round(v))} kWh`, "Energy"]} />
                  <Area type="monotone" dataKey={metric === "energy" ? "totalEnergy" : metric} stroke={CHART_COLORS[metric] || "#F7941D"} fill="url(#gradEnergy)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* PR trend */}
            <Card title="Average Performance Ratio Trend">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={dateFmt} interval="preserveStartEnd" />
                  <YAxis domain={[0.4, 1.0]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip labelFormatter={dateFmt} formatter={(v) => [`${(v * 100).toFixed(1)}%`, "Avg PR"]} />
                  <ReferenceLine y={0.80} stroke="#0E9B65" strokeDasharray="4 3" label={{ value: "Excellent (80%)", position: "right", fontSize: 9, fill: "#0E9B65" }} />
                  <ReferenceLine y={0.70} stroke="#F7941D" strokeDasharray="4 3" label={{ value: "Good (70%)", position: "right", fontSize: 9, fill: "#F7941D" }} />
                  <ReferenceLine y={0.55} stroke="#DC2626" strokeDasharray="4 3" label={{ value: "Fair (55%)", position: "right", fontSize: 9, fill: "#DC2626" }} />
                  <Line type="monotone" dataKey="avgPR" stroke="#1E5BA6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* Cumulative generation */}
            <Card title="Cumulative Energy Generation">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={cumulativeData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradCum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1E5BA6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#1E5BA6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={dateFmt} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={65} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip labelFormatter={dateFmt} formatter={(v) => [`${fmt(Math.round(v))} kWh`, "Cumulative"]} />
                  <Area type="monotone" dataKey="cumEnergy" stroke="#1E5BA6" fill="url(#gradCum)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* PR Histogram */}
            <Card title="PR Distribution (Plants Count)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={prHist} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v) => [`${v} plants`, "Count"]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {prHist.map((d, i) => {
                      const colors = ["#DC2626", "#F7941D", "#1E5BA6", "#0E9B65", "#0E9B65"];
                      return <Cell key={i} fill={colors[i] || "#F7941D"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Grade dist + Top/Bottom tables */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            {/* Grade distribution */}
            <Card title="Fleet Grade Distribution">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {["Excellent","Good","Fair","Poor","N/A"].map((g) => {
                  const item = gradeDist.find((x) => x.grade === g);
                  const count = item?.count || 0;
                  const pct   = s?.totalPlants ? (count / s.totalPlants) * 100 : 0;
                  return (
                    <div key={g}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ fontWeight: 500, color: GRADE_COLORS[g] }}>{g}</span>
                        <span style={{ color: "var(--color-text-secondary)" }}>{count} plants ({pct.toFixed(0)}%)</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: "var(--color-background-secondary)" }}>
                        <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: GRADE_COLORS[g], transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Top 5 performers */}
            <Card title="🏆 Top 5 Performers">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {top5.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--color-border-light)" }}>
                    <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{"🥇🥈🥉🏅🏅"[i]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: GRADE_COLORS[p.grade], fontWeight: 500 }}>{p.grade}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0E9B65" }}>{fmtPct(p.pr)}</span>
                  </div>
                ))}
                {!top5.length && <div style={{ color: "var(--color-text-tertiary)", fontSize: 12, textAlign: "center", padding: 20 }}>No data</div>}
              </div>
            </Card>

            {/* Bottom 5 performers */}
            <Card title="⚠ Needs Attention">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bottom5.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--color-border-light)" }}>
                    <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{"🔴🟠🟡🟡🟡"[i]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: GRADE_COLORS[p.grade], fontWeight: 500 }}>{p.grade}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>{fmtPct(p.pr)}</span>
                  </div>
                ))}
                {!bottom5.length && <div style={{ color: "var(--color-text-tertiary)", fontSize: 12, textAlign: "center", padding: 20 }}>No data</div>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
