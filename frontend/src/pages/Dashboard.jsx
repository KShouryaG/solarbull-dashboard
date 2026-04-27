import { useState, useEffect, useMemo, useCallback } from "react";
import { clearCache, getUsers } from "../api.js";
import { useAuth } from "../auth.jsx";
import { usePlants } from "../context/PlantContext.jsx";
import MetricCard from "../components/MetricCard.jsx";
import PlantCard from "../components/PlantCard.jsx";
import SmartSearch from "../components/SmartSearch.jsx";
import { useNavigate } from "react-router-dom";
import { fmt, fmtPct, rupee } from "../utils/format.js";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function fmtLarge(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GWh`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} GWh`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} MWh`;
  return `${fmt(Math.round(n))} kWh`;
}

function PowerChart({ totalPower, totalCap }) {
  const data = useMemo(() => {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const peak = totalPower || (totalCap ? totalCap * 0.18 : 0);
    const peakHour = 13;
    return Array.from({ length: 13 }, (_, i) => {
      const hour = 6 + i;
      const label = hour <= 12 ? `${hour}am` : hour === 12 ? "12pm" : `${hour - 12}pm`;
      const gaussian = (x) => Math.max(0, Math.exp(-0.5 * ((x - peakHour) / 3.5) ** 2));
      const value = hour > h ? null : Math.round(peak * gaussian(hour));
      return { label, value, projected: Math.round(peak * gaussian(hour)) };
    });
  }, [totalPower, totalCap]);

  const peakVal = Math.max(...data.map((d) => d.projected || 0));

  return (
    <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-lg)", padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Today's power output</div>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>kW</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginBottom: 12 }}>
        {peakVal > 0 ? `Peaked at ${Math.round(peakVal).toLocaleString()} kW around 1pm` : "No output data yet"}
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="pwrGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#F7941D" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#F7941D" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => [`${v?.toLocaleString() ?? "—"} kW`, "Power"]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--color-border-light)" }} />
          <Area type="monotone" dataKey="projected" stroke="var(--sb-orange)" strokeWidth={1.5} fill="url(#pwrGrad)" strokeDasharray="4 3" dot={false} connectNulls={false} />
          <Area type="monotone" dataKey="value"     stroke="var(--sb-orange)" strokeWidth={2}   fill="url(#pwrGrad)" dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const { plants, loading, error, fetchPlants, refresh: refreshPlants } = usePlants();
  const [filter,       setFilter]      = useState("all");
  const [search,       setSearch]      = useState("");
  const [lastRefreshed, setLast]       = useState(new Date());
  const [users,        setUsers]       = useState([]);
  const [showFilters,  setShowFilters] = useState(false);
  const [filterCity,   setFilterCity]  = useState("");
  const [filterGrade,  setFilterGrade] = useState("");
  const [filterModel,  setFilterModel] = useState("");
  const [filterCapMin, setFilterCapMin] = useState("");
  const [filterCapMax, setFilterCapMax] = useState("");
  const [filterClient, setFilterClient] = useState("");

  const load = useCallback(async () => {
    await fetchPlants();
    setLast(new Date());
  }, [fetchPlants]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (user?.role === "admin") getUsers().then(setUsers).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    const t = setInterval(() => { refreshPlants(); setLast(new Date()); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshPlants]);

  const totals = useMemo(() => {
    const online   = plants.filter((p) => p.status === "online").length;
    const warning  = plants.filter((p) => p.status === "warning").length;
    const offline  = plants.filter((p) => p.status === "offline").length;
    const totalCap = plants.reduce((s, p) => s + (p.capacity || 0), 0);
    const totalPower = plants.some((p) => p.currentPower != null)
      ? plants.reduce((s, p) => s + (p.currentPower ?? 0), 0) : null;
    const todayGen = plants.reduce((s, p) => s + (p.todayEnergy || 0), 0);
    const monthGen = plants.some((p) => p.monthEnergy != null)
      ? plants.reduce((s, p) => s + (p.monthEnergy ?? 0), 0) : null;
    const totalErrors = plants.reduce((s, p) => s + (p.errors?.length || 0), 0);
    const activePlants = plants.filter((p) => p.status !== "offline");
    const avgPR = activePlants.length
      ? activePlants.reduce((s, p) => s + (p.performanceRatio ?? 0), 0) / activePlants.length : null;
    const monthRev  = monthGen !== null ? Math.round(monthGen * 4.5) : null;
    const co2Kg     = monthGen !== null ? monthGen * 0.82 : null;
    const co2Saved  = co2Kg !== null ? (co2Kg / 1000).toFixed(1) : null;
    const trees     = co2Kg !== null ? fmt(Math.round(co2Kg / 22)) : null;
    const utilPct   = totalCap > 0 && totalPower !== null
      ? Math.round((totalPower / totalCap) * 100) : null;
    return { online, warning, offline, totalCap, totalPower, todayGen, monthGen, totalErrors, avgPR, monthRev, co2Saved, trees, utilPct };
  }, [plants]);

  // Sparkline data — generated once on mount, shaped like real solar curves
  const sparklines = useMemo(() => {
    const h = new Date().getHours();
    const bell = (hour) => Math.max(0, Math.sin(Math.PI * (hour - 5.5) / 13));
    return {
      power:  Array.from({ length: 12 }, (_, i) => bell(Math.max(0, h - 10 + i))),
      energy: Array.from({ length: 12 }, (_, i) => (i / 11) * bell(h) + Math.max(0, bell(h - 1)) * (i > 0 ? 1 : 0)),
      month:  Array.from({ length: 12 }, (_, i) => 0.45 + (i / 11) * 0.4 + [0,.04,-.03,.06,-.02,.05,.01,-.04,.07,.03,-.01,.02][i]),
      health: Array.from({ length: 12 }, (_, i) => 0.72 + [0,.02,-.01,.03,.01,-.02,.04,.01,-.01,.02,.03,.01][i]),
    };
  }, []);

  // Fleet status line with specific offline site names
  const offlineSites  = useMemo(() => plants.filter((p) => p.status === "offline"), [plants]);
  const warningSites  = useMemo(() => plants.filter((p) => p.status === "warning"),  [plants]);

  const cities  = useMemo(() => [...new Set(plants.map((p) => p.city).filter(Boolean))].sort(), [plants]);
  const models  = useMemo(() => [...new Set(plants.flatMap((p) => p.devices?.map((d) => d.model) || []).filter(Boolean))].sort(), [plants]);
  const clients = useMemo(() => users.filter((u) => u.role === "client"), [users]);

  const clientPlantIds = useMemo(() => {
    if (!filterClient) return null;
    const client = clients.find((c) => String(c.id) === filterClient);
    if (!client) return null;
    try { return new Set(JSON.parse(client.plant_ids || "[]")); } catch { return null; }
  }, [filterClient, clients]);

  const filtered = useMemo(() => {
    let f = plants;
    if (filter !== "all")  f = f.filter((p) => p.status === filter);
    if (search)            f = f.filter((p) => (p.name + (p.city || "")).toLowerCase().includes(search.toLowerCase()));
    if (filterCity)        f = f.filter((p) => (p.city || "").toLowerCase().includes(filterCity.toLowerCase()));
    if (filterGrade)       f = f.filter((p) => p.grade === filterGrade);
    if (filterModel)       f = f.filter((p) => p.devices?.some((d) => (d.model || "").includes(filterModel)));
    if (filterCapMin)      f = f.filter((p) => (p.capacity || 0) >= parseFloat(filterCapMin));
    if (filterCapMax)      f = f.filter((p) => (p.capacity || 0) <= parseFloat(filterCapMax));
    if (clientPlantIds)    f = f.filter((p) => clientPlantIds.has(p.id));
    return f;
  }, [plants, filter, search, filterCity, filterGrade, filterModel, filterCapMin, filterCapMax, clientPlantIds]);

  const hasActiveFilters = filterCity || filterGrade || filterModel || filterCapMin || filterCapMax || filterClient;
  const clearFilters = () => {
    setFilterCity(""); setFilterGrade(""); setFilterModel("");
    setFilterCapMin(""); setFilterCapMax(""); setFilterClient("");
  };

  const allErrors = useMemo(() => {
    const errs = [];
    plants.forEach((p) => (p.errors || []).forEach((e) => errs.push({ ...e, plantName: p.name, plantId: p.id })));
    errs.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
    return errs;
  }, [plants]);

  const criticalCount = useMemo(() => allErrors.filter((e) => e.severity === "high").length, [allErrors]);
  const firstCritical = useMemo(() => allErrors.find((e) => e.severity === "high"), [allErrors]);

  return (
    <div className="fade-in">
      {/* Error banner */}
      {error && (
        <div style={{ background: "#FEF0F0", border: "1px solid #DC2626", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 500 }}>
          ⚠ Failed to load plants: {error}
        </div>
      )}

      {/* Top bar: SmartSearch + action controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <SmartSearch />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0E9B65", boxShadow: "0 0 0 3px #0E9B6522", display: "inline-block" }} />
            {lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button
            onClick={() => { refreshPlants(); setLast(new Date()); }}
            disabled={loading}
            style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "8px 16px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
          {user?.role === "admin" && (
            <button onClick={() => clearCache().then(refreshPlants)} style={{ fontSize: 12 }}>Clear cache</button>
          )}
        </div>
      </div>

      {/* Greeting + fleet summary */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>
          {timeGreeting()}, {user?.name?.split(" ")[0] || "there"}
        </h1>
        <div style={{ fontSize: 13.5, color: "var(--color-text-secondary)", marginTop: 5, lineHeight: 1.6 }}>
          {loading ? "Loading fleet data…" : (
            <>
              <span style={{ color: "#0E9B65", fontWeight: 600 }}>{totals.online} of {plants.length} sites</span> are healthy
              {warningSites.length > 0 && (
                <>, <span style={{ color: "#B45309", fontWeight: 600 }}>{warningSites.length} need a look</span></>
              )}
              {offlineSites.length > 0 && (
                <>, and{" "}
                  <span style={{ color: "#DC2626", fontWeight: 600 }}>
                    {offlineSites.length === 1
                      ? offlineSites[0].city || offlineSites[0].name
                      : `${offlineSites[0].city || offlineSites[0].name} + ${offlineSites.length - 1} more`}
                    {" "}offline
                  </span>
                </>
              )}
              {totals.utilPct !== null && <>. Generating at <span style={{ fontWeight: 600 }}>{totals.utilPct}% of capacity</span> right now.</>}
            </>
          )}
        </div>
      </div>

      {/* Attention callout — critical alerts only */}
      {!loading && criticalCount > 0 && (
        <div style={{
          background: "linear-gradient(90deg, #FEF0F0 0%, #FFFFFF 60%)",
          border: "1px solid #F5D0D0", borderRadius: 12,
          padding: "14px 18px", marginBottom: 22,
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "#FEE2E2", color: "#DC2626",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 16,
          }}>⚠</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              {criticalCount} site{criticalCount > 1 ? "s" : ""} need{criticalCount === 1 ? "s" : ""} urgent attention
            </div>
            {firstCritical && (
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                Biggest issue: <b style={{ color: "#DC2626" }}>{firstCritical.plantName}</b> — {firstCritical.desc}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate("/notifications")}
            style={{ padding: "8px 14px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
            Review now →
          </button>
        </div>
      )}

      {/* KPI strip — row 1 */}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 10 }}>
        At a glance
      </div>
      <div className="kpi-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <MetricCard label="Generating now" value={totals.totalPower !== null ? `${fmt(Math.round(totals.totalPower))} kW` : "—"} accent="var(--sb-orange)" sub={totals.utilPct !== null ? `${totals.utilPct}% of max capacity` : "Real-time output"} sparkline={sparklines.power} sparklineColor="var(--sb-orange)" />
        <MetricCard label="Today so far"   value={`${fmtLarge(totals.todayGen * 1000)}`}  sub="Since midnight" trend="up" sparkline={sparklines.energy} sparklineColor="#F7941D" />
        <MetricCard label="This month"     value={totals.monthGen !== null ? fmtLarge(totals.monthGen * 1000) : "—"} sub={totals.monthRev !== null ? `Rev: ${rupee(totals.monthRev)}` : "Estimated MTD"} trend="up" sparkline={sparklines.month} sparklineColor="var(--sb-blue)" />
        <MetricCard label="Fleet health"   value={totals.avgPR !== null ? fmtPct(totals.avgPR) : "—"} sub={totals.avgPR !== null ? (totals.avgPR >= 0.80 ? "Excellent range" : totals.avgPR >= 0.70 ? "Healthy range" : "Needs attention") : "Avg performance ratio"} sparkline={sparklines.health} sparklineColor="#0E9B65" />
      </div>

      {/* KPI strip — row 2 */}
      <div className="kpi-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        <MetricCard label="Total capacity" value={`${fmt(Math.round(totals.totalCap))} kWp`} sub={`${plants.length} sites`} />
        <MetricCard label="Sites online"   value={`${totals.online}/${plants.length}`} accent="var(--color-grade-excellent)" sub={`${totals.warning} warning · ${totals.offline} offline`} />
        <MetricCard label="Open alerts"    value={String(totals.totalErrors)} accent={totals.totalErrors > 0 ? "var(--color-text-danger)" : undefined} sub={`${criticalCount} urgent · ${totals.totalErrors - criticalCount} moderate`} />
        <MetricCard label="Month revenue"  value={totals.monthRev !== null ? rupee(totals.monthRev) : "—"} sub="@ ₹4.50/kWh est." />
      </div>

      {/* Main 2-column layout */}
      <div className="dashboard-main-grid" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 24 }}>

        {/* Left: site cards */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Your sites</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>Click any site to open its detail page</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ height: 32, padding: "0 10px", width: "auto", fontSize: 12 }}>
                <option value="all">All sites ({plants.length})</option>
                <option value="online">Online ({totals.online})</option>
                <option value="warning">Warning ({totals.warning})</option>
                <option value="offline">Offline ({totals.offline})</option>
              </select>
              {user?.role === "admin" && (
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  style={{
                    height: 32, padding: "0 12px", fontSize: 12,
                    background: hasActiveFilters ? "var(--sb-blue)" : "var(--color-background-primary)",
                    color: hasActiveFilters ? "#fff" : "var(--color-text-secondary)",
                    border: "1px solid var(--color-border-light)", borderRadius: 8,
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                  ⚙ Filters{hasActiveFilters ? ` (${[filterCity, filterGrade, filterModel, filterCapMin, filterCapMax, filterClient].filter(Boolean).length})` : ""}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sites..." style={{ maxWidth: 220 }} />
            {hasActiveFilters && (
              <button onClick={clearFilters} style={{ fontSize: 11, color: "var(--color-text-danger)", background: "transparent", border: "none" }}>
                ✕ Clear filters
              </button>
            )}
          </div>

          {/* Grade legend */}
          <div style={{ fontSize: 11, marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap", padding: "8px 12px", background: "var(--sb-orange-light)", borderRadius: 8 }}>
            <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>PR health:</span>
            <span><b style={{ color: "#0E9B65" }}>Excellent</b> ≥80%</span>
            <span><b style={{ color: "#1E5BA6" }}>Good</b> ≥70%</span>
            <span><b style={{ color: "#F7941D" }}>Fair</b> ≥55%</span>
            <span><b style={{ color: "#DC2626" }}>Poor</b> &lt;55%</span>
          </div>

          {/* Admin filter panel */}
          {user?.role === "admin" && showFilters && (
            <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-lg)", padding: "16px 20px", marginBottom: 16, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>Fleet Filters</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Client</label>
                  <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} style={{ width: "100%", fontSize: 12 }}>
                    <option value="">All clients</option>
                    {clients.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>City</label>
                  <input value={filterCity} onChange={(e) => setFilterCity(e.target.value)} placeholder="e.g. Hyderabad" style={{ fontSize: 12 }} list="city-list" />
                  <datalist id="city-list">{cities.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Grade</label>
                  <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)} style={{ width: "100%", fontSize: 12 }}>
                    <option value="">All grades</option>
                    {["Excellent", "Good", "Fair", "Poor"].map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Inverter Model</label>
                  <input value={filterModel} onChange={(e) => setFilterModel(e.target.value)} placeholder="e.g. SG50CX" style={{ fontSize: 12 }} list="model-list" />
                  <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Capacity Min (kWp)</label>
                  <input type="number" value={filterCapMin} onChange={(e) => setFilterCapMin(e.target.value)} placeholder="e.g. 50" style={{ fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Capacity Max (kWp)</label>
                  <input type="number" value={filterCapMax} onChange={(e) => setFilterCapMax(e.target.value)} placeholder="e.g. 500" style={{ fontSize: 12 }} />
                </div>
              </div>
              {filtered.length !== plants.length && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--sb-blue)", fontWeight: 500 }}>
                  Showing {filtered.length} of {plants.length} sites
                </div>
              )}
            </div>
          )}

          {/* Site cards grid */}
          {loading && !plants.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-lg)", padding: 16 }}>
                  <div className="skeleton" style={{ height: 14, width: "70%", marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 11, width: "45%", marginBottom: 16 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                    {[1, 2, 3].map((j) => <div key={j} className="skeleton" style={{ height: 32 }} />)}
                  </div>
                  <div className="skeleton" style={{ height: 22, width: "40%" }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {filtered.map((p) => <PlantCard key={p.id} plant={p} />)}
              {!filtered.length && (
                <div style={{ padding: 24, color: "var(--color-text-tertiary)", gridColumn: "1/-1" }}>
                  No sites match filter.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Recent alerts panel */}
          <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-lg)", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Recent alerts</div>
              <span onClick={() => navigate("/notifications")} style={{ fontSize: 12, color: "var(--sb-blue)", fontWeight: 500, cursor: "pointer" }}>
                See all →
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginBottom: 12 }}>Most urgent first</div>
            {allErrors.length === 0 ? (
              <div style={{ padding: "12px 0", color: "#0E9B65", fontSize: 13, fontWeight: 500 }}>
                ✓ No active alerts — all sites nominal
              </div>
            ) : (
              allErrors.slice(0, 6).map((a, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "auto 1fr",
                  gap: "0 10px", padding: "10px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--color-border-light)",
                  alignItems: "flex-start",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", marginTop: 4, flexShrink: 0, display: "inline-block",
                    background: a.severity === "high" ? "#DC2626" : a.severity === "medium" ? "#F7941D" : "#9CA3AF",
                  }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4 }}>{a.desc}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{a.plantName}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Today's power output chart */}
          <PowerChart totalPower={totals.totalPower} totalCap={totals.totalCap} />

          {/* CO₂ impact widget */}
          <div style={{
            background: "linear-gradient(135deg, var(--sb-orange-light) 0%, #FFFFFF 70%)",
            border: "1px solid var(--color-border-light)",
            borderRadius: "var(--border-radius-lg)", padding: 18,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>🌿</span>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Your impact this month</div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginBottom: 14 }}>
              What your clean energy has prevented
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
                  {totals.co2Saved ?? "—"}<span style={{ fontSize: 13, fontWeight: 500 }}> t</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>CO₂ avoided</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
                  {totals.trees ?? "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>Equiv. trees planted</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
