import { useState, useEffect, useMemo, useCallback } from "react";
import { clearCache } from "../api.js";
import { useAuth } from "../auth.jsx";
import { usePlants } from "../context/PlantContext.jsx";
import MetricCard from "../components/MetricCard.jsx";
import PlantCard from "../components/PlantCard.jsx";
import AlertsTable from "../components/AlertsTable.jsx";
import { useNavigate } from "react-router-dom";
import { fmt, fmtPct, fmtKWh, rupee } from "../utils/format.js";
import { GRADE_COLORS } from "../utils/computed.js";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

const TABS = ["overview", "alerts", "charts"];

export default function Dashboard() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const { plants, loading, error, fetchPlants, refresh: refreshPlants } = usePlants();
  const [tab,      setTab]      = useState("overview");
  const [filter,   setFilter]   = useState("all");
  const [search,   setSearch]   = useState("");
  const [lastRefreshed, setLast] = useState(new Date());

  const load = useCallback(async () => {
    await fetchPlants();
    setLast(new Date());
  }, [fetchPlants]);

  useEffect(() => { load(); }, []);

  // Auto-refresh every 5 min
  useEffect(() => {
    const t = setInterval(() => { refreshPlants(); setLast(new Date()); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshPlants]);

  const totals = useMemo(() => {
    const online  = plants.filter((p) => p.status === "online").length;
    const warning = plants.filter((p) => p.status === "warning").length;
    const offline = plants.filter((p) => p.status === "offline").length;
    const totalCap   = plants.reduce((s, p) => s + (p.capacity || 0), 0);
    const totalPower = plants.some((p) => p.currentPower !== null && p.currentPower !== undefined)
      ? plants.reduce((s, p) => s + (p.currentPower ?? 0), 0) : null;
    const todayGen   = plants.reduce((s, p) => s + (p.todayEnergy || 0), 0);
    const monthGen   = plants.some((p) => p.monthEnergy !== null && p.monthEnergy !== undefined)
      ? plants.reduce((s, p) => s + (p.monthEnergy ?? 0), 0) : null;
    const totalErrors = plants.reduce((s, p) => s + (p.errors?.length || 0), 0);
    const activePlants = plants.filter((p) => p.status !== "offline");
    const avgPR = activePlants.length
      ? activePlants.reduce((s, p) => s + (p.performanceRatio ?? 0), 0) / activePlants.length : null;
    const monthRev = monthGen !== null ? Math.round(monthGen * 4.5) : null;
    return { online, warning, offline, totalCap, totalPower, todayGen, monthGen, totalErrors, avgPR, monthRev };
  }, [plants]);

  const filtered = useMemo(() => {
    let f = plants;
    if (filter !== "all") f = f.filter((p) => p.status === filter);
    if (search) f = f.filter((p) => (p.name + p.city).toLowerCase().includes(search.toLowerCase()));
    return f;
  }, [plants, filter, search]);

  const allErrors = useMemo(() => {
    const errs = [];
    plants.forEach((p) => (p.errors || []).forEach((e) => errs.push({ ...e, plantName: p.name, plantId: p.id })));
    errs.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - ({ high: 0, medium: 1, low: 2 }[b.severity])));
    return errs;
  }, [plants]);

  // Grade distribution for pie chart
  const gradeDist = useMemo(() => {
    const counts = {};
    plants.forEach((p) => { counts[p.grade || "N/A"] = (counts[p.grade || "N/A"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value, color: GRADE_COLORS[name] || "#ccc" }));
  }, [plants]);

  // Top 8 by today energy for bar chart
  const topByEnergy = useMemo(() => {
    return [...plants]
      .sort((a, b) => (b.todayEnergy || 0) - (a.todayEnergy || 0))
      .slice(0, 8)
      .map((p) => ({ name: p.name.split(" ").slice(-2).join(" "), energy: p.todayEnergy || 0 }));
  }, [plants]);

  return (
    <div className="fade-in">
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Fleet Overview</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {loading ? "Loading…" : `${plants.length} plants`} · Last updated {lastRefreshed.toLocaleTimeString("en-IN")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { refreshPlants(); setLast(new Date()); }} disabled={loading} style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "8px 16px" }}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
          {user?.role === "admin" && (
            <button onClick={() => clearCache().then(refreshPlants)} style={{ fontSize: 12 }}>Clear cache</button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "#FEF0F0", border: "1px solid #DC2626", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 500 }}>
          ⚠ Failed to load plants: {error}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <MetricCard label="Total Capacity"  value={`${fmt(Math.round(totals.totalCap))} kWp`}  sub={`${plants.length} plants`} icon="⚡" />
        <MetricCard label="Live Power"      value={totals.totalPower !== null ? `${fmt(Math.round(totals.totalPower))} kW` : "—"} accent="var(--sb-orange)" sub="Real-time output" icon="☀" />
        <MetricCard label="Today Generated" value={`${fmt(Math.round(totals.todayGen))} kWh`}  sub="Since midnight" icon="📈" />
        <MetricCard label="Month Generated" value={totals.monthGen !== null ? `${fmt(Math.round(totals.monthGen))} kWh` : "—"} sub={totals.monthRev !== null ? `Rev: ${rupee(totals.monthRev)}` : "Not in API"} icon="📅" />
        <MetricCard label="Fleet Status"    value={`${totals.online}/${plants.length}`} accent="var(--color-grade-excellent)" sub={`${totals.warning} warn · ${totals.offline} off`} icon="🏭" />
        <MetricCard label="Avg PR"          value={totals.avgPR !== null ? fmtPct(totals.avgPR) : "—"} sub="Performance ratio" icon="📊" />
        <MetricCard label="Active Alerts"   value={String(totals.totalErrors)} accent={totals.totalErrors > 0 ? "var(--color-text-danger)" : undefined} sub={`${plants.filter((p) => (p.errors||[]).some((e) => e.severity === "high")).length} critical`} icon="⚠" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid var(--color-border-light)", marginBottom: 20 }}>
        {[["overview", "Plants"], ["alerts", `Alerts (${totals.totalErrors})`], ["charts", "Charts"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "10px 20px", fontSize: 13, fontWeight: tab === key ? 600 : 400,
            color: tab === key ? "var(--sb-blue)" : "var(--color-text-secondary)",
            borderBottom: tab === key ? "2px solid var(--sb-blue)" : "2px solid transparent",
            background: "none", border: "none", borderRadius: 0, marginBottom: -2,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === "overview" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plants..." style={{ maxWidth: 220 }} />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="all">All ({plants.length})</option>
              <option value="online">Online ({totals.online})</option>
              <option value="warning">Warning ({totals.warning})</option>
              <option value="offline">Offline ({totals.offline})</option>
            </select>
          </div>
          {loading && !plants.length ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-tertiary)" }}>Loading plants...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {filtered.map((p) => <PlantCard key={p.id} plant={p} />)}
              {!filtered.length && <div style={{ padding: 24, color: "var(--color-text-tertiary)", gridColumn: "1/-1" }}>No plants match filter.</div>}
            </div>
          )}
        </>
      )}

      {/* Tab: Alerts */}
      {tab === "alerts" && (
        <AlertsTable alarms={allErrors} showPlant onPlantClick={(id) => navigate(`/plants/${id}`)} />
      )}

      {/* Tab: Charts */}
      {tab === "charts" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Grade distribution */}
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Grade Distribution</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={gradeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {gradeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} plants`, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top plants by generation */}
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Top Plants — Today's Generation</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topByEnergy} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v/1000).toFixed(1)}K`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={80} />
                <Tooltip formatter={(v) => [`${v} kWh`, "Energy"]} />
                <Bar dataKey="energy" fill="var(--sb-orange)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Status breakdown */}
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Plant Status Breakdown</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={[
                  { name: "Online",  value: totals.online,  color: "#0E9B65" },
                  { name: "Warning", value: totals.warning, color: "#F7941D" },
                  { name: "Offline", value: totals.offline, color: "#DC2626" },
                ].filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {[0,1,2].map((i, idx) => {
                    const c = ["#0E9B65","#F7941D","#DC2626"];
                    return <Cell key={idx} fill={c[idx]} />;
                  })}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} plants`, n]} />
                <Legend iconType="circle" iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Capacity vs Generation */}
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Capacity Utilization (Top 8)</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={[...plants].sort((a,b)=>(b.capacity||0)-(a.capacity||0)).slice(0,8).map(p=>({
                  name: p.name.split(" ").slice(-2).join(" "),
                  capacity: p.capacity || 0,
                  energy: p.todayEnergy || 0,
                }))}
                margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend iconType="square" iconSize={10} />
                <Bar dataKey="capacity" name="Capacity (kWp)" fill="var(--sb-blue)" radius={[4,4,0,0]} />
                <Bar dataKey="energy"   name="Today (kWh)"   fill="var(--sb-orange)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
