import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getInverters } from "../api.js";
import { usePlants } from "../context/PlantContext.jsx";
import MetricCard from "../components/MetricCard.jsx";
import { StatusBadge, GradeBadge, SeverityBadge } from "../components/Badge.jsx";
import AlertsTable from "../components/AlertsTable.jsx";
import TimeSeriesChart from "../components/TimeSeriesChart.jsx";
import { fmt, fmtDec, fmtPct, fmtKW, rupee, formatDate } from "../utils/format.js";
import { BENCHMARKS, plantAge, degradedCapacity, GRADE_COLORS } from "../utils/computed.js";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const TABS = [
  ["stats",     "Full Stats"],
  ["inverters", "Inverters"],
  ["financial", "Financial & Env"],
  ["timeseries","Charts"],
  ["alerts",    "Alerts"],
  ["history",   "7-Day History"],
];

export default function PlantDetail() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { plants, loading: plantsLoading, fetchPlants } = usePlants();
  const [inverters, setInverters] = useState([]);
  const [invLoading, setInvLoading] = useState(true);
  const [tab,       setTab]       = useState("stats");

  // Ensure plants are loaded
  useEffect(() => { fetchPlants(); }, []);

  // Load inverters separately (fast, single plant)
  useEffect(() => {
    setInvLoading(true);
    getInverters(id).then((d) => setInverters(d.inverters || [])).catch(() => setInverters([])).finally(() => setInvLoading(false));
  }, [id]);

  const plant   = plants.find((p) => p.id === id) || null;
  const loading = plantsLoading && !plant;

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!plant) return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-secondary)" }}>
      Plant not found. <span style={{ color: "var(--sb-blue)", cursor: "pointer" }} onClick={() => navigate("/")}>← Back</span>
    </div>
  );

  const age       = plantAge(plant.installDate);
  const degraded  = age ? degradedCapacity(plant.capacity, age) : null;
  const co2Total  = plant.co2Avoided || plant.co2 || 0;
  const trees     = Math.round(co2Total / 21);
  const coal      = Math.round(co2Total / 2.42 / 1000 * 10) / 10; // coal saved in tonnes
  const homes     = Math.round((plant.totalEnergy || 0) / 1200);   // avg Indian home: ~1200 kWh/yr
  const revenue30 = Math.round((plant.todayEnergy || 0) * 26 * (plant.tariffPerKwh || 4.5));
  const revenue365 = Math.round((plant.todayEnergy || 0) * 300 * (plant.tariffPerKwh || 4.5));
  const payback   = plant.capacity ? Math.round(plant.capacity * 45000 / Math.max(revenue365, 1) * 10) / 10 : null; // ~₹45k/kWp installed cost

  const radarData = [
    { metric: "PR",       value: plant.performanceRatio ? Math.min(100, plant.performanceRatio * 100) : 0 },
    { metric: "CF%",      value: plant.capacityFactor   ? Math.min(100, plant.capacityFactor)          : 0 },
    { metric: "Avail",    value: plant.status === "online" ? 98 : plant.status === "warning" ? 80 : 30 },
    { metric: "Yield",    value: plant.specificYield ? Math.min(100, (plant.specificYield / 7) * 100) : 0 },
  ];

  const historyData = (plant.history || []).map((h) => ({
    date: h.date?.slice(5), energy: h.energy || 0,
  }));

  const secH = (title) => (
    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", margin: "24px 0 12px", paddingBottom: 6, borderBottom: "2px solid var(--sb-orange)", display: "inline-block" }}>
      {title}
    </div>
  );

  const row = (label, value, hint) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--color-border-light)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "right", maxWidth: 200 }}>{value}</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16 }}>
        <span style={{ cursor: "pointer", color: "var(--sb-blue)" }} onClick={() => navigate("/")}>Dashboard</span>
        <span style={{ margin: "0 6px" }}>›</span>
        <span>{plant.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{plant.name}</h1>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
            {plant.devices?.[0]?.model || "Sungrow"} · {plant.city}
            {plant.latitude && plant.longitude && ` · ${Number(plant.latitude).toFixed(3)}°N, ${Number(plant.longitude).toFixed(3)}°E`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <GradeBadge grade={plant.grade} />
          <StatusBadge status={plant.status} />
          <button onClick={() => navigate(`/compare?ids=${plant.id}`)} style={{ fontSize: 12, padding: "6px 14px", background: "transparent", border: "1px solid var(--color-border-light)", borderRadius: 6, color: "var(--sb-blue)" }}>
            ⚖ Compare
          </button>
        </div>
      </div>

      {/* KPI Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginBottom: 24 }}>
        <MetricCard label="Capacity"        value={`${fmtDec(plant.capacity)} kWp`} icon="⚡" />
        <MetricCard label="Live Power"      value={plant.currentPower != null ? fmtKW(plant.currentPower) : "—"} accent="var(--sb-orange)" icon="☀" />
        <MetricCard label="Today"           value={`${fmt(plant.todayEnergy)} kWh`} icon="📈" />
        <MetricCard label="This Month"      value={plant.monthEnergy != null ? `${fmt(plant.monthEnergy)} kWh` : "—"} icon="📅" />
        <MetricCard label="Lifetime"        value={`${fmt(Math.round((plant.totalEnergy||0)/1000))} MWh`} icon="🏆" />
        <MetricCard label="Perf. Ratio"     value={plant.performanceRatio != null ? fmtPct(plant.performanceRatio) : "—"} accent={plant.performanceRatio ? GRADE_COLORS[plant.grade] : undefined} icon="📊" />
        <MetricCard label="Specific Yield"  value={plant.specificYield != null ? `${fmtDec(plant.specificYield)} kWh/kWp` : "—"} icon="📐" />
        <MetricCard label="Revenue Today"   value={rupee(Math.round(plant.revenueToday || 0))} icon="₹" />
        <MetricCard label="CO₂ Avoided"     value={`${fmt(Math.round(co2Total/1000))} t`} icon="🌿" sub={`${fmt(trees)} trees equiv`} />
        <MetricCard label="Active Alerts"   value={String(plant.errors?.length || 0)} accent={(plant.errors?.length || 0) > 0 ? "#DC2626" : undefined} icon="⚠" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--color-border-light)", marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: "10px 18px", fontSize: 13, fontWeight: tab === k ? 600 : 400,
            color: tab === k ? "var(--sb-blue)" : "var(--color-text-secondary)",
            borderBottom: tab === k ? "2px solid var(--sb-blue)" : "2px solid transparent",
            background: "none", border: "none", borderRadius: 0, marginBottom: -2,
          }}>{l}</button>
        ))}
      </div>

      {/* ─── FULL STATS ─────────────────────────────── */}
      {tab === "stats" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            {secH("Performance & Generation")}
            {row("Capacity (STC)",      `${fmtDec(plant.capacity)} kWp`,    "Rated at Standard Test Conditions")}
            {row("Live Power",          plant.currentPower != null ? fmtKW(plant.currentPower) : "—", "Real-time AC output")}
            {row("Today's Energy",      `${fmt(plant.todayEnergy)} kWh`,     "Since midnight")}
            {row("This Month",          plant.monthEnergy != null ? `${fmt(plant.monthEnergy)} kWh` : "—")}
            {row("Lifetime Energy",     `${fmt(Math.round((plant.totalEnergy||0)/1000))} MWh`)}
            {row("Specific Yield",      plant.specificYield ? `${fmtDec(plant.specificYield)} kWh/kWp/day` : "—", "Energy per rated kWp")}
            {row("Performance Ratio",   plant.performanceRatio ? fmtPct(plant.performanceRatio) : "—", `Benchmark ≥${(BENCHMARKS.pr.good*100).toFixed(0)}% good, ≥${(BENCHMARKS.pr.excellent*100).toFixed(0)}% excellent`)}
            {row("Capacity Factor",     plant.capacityFactor ? `${fmtDec(plant.capacityFactor)}%` : "—", "Actual vs theoretical 24h output")}
            {row("Grade",               <GradeBadge grade={plant.grade} />)}

            {secH("Technical Parameters")}
            {row("Panel Efficiency",    "22–24%",           "Mono-PERC / TOPCon (STC)")}
            {row("Inverter Efficiency", "97–99%",           "DC→AC (Sungrow typical)")}
            {row("Peak Sun Hours",      `${fmtDec(plant.peakSunHours || 5.5)} h/day`, "India irradiance reference")}
            {row("Temp. Coefficient",   "−0.35%/°C",        "Power derating above 25°C")}
            {row("Annual Degradation",  "~0.5%/yr",         "Industry standard c-Si modules")}
            {age ? row("Plant Age",     `${age} years`,     `Installed ${formatDate(plant.installDate)}`) : null}
            {degraded ? row("Est. Current Capacity", `${fmtDec(degraded)} kWp`, `After ${age}y degradation`) : null}
          </div>
          <div>
            {secH("Reliability")}
            {row("Status",              <StatusBadge status={plant.status} />)}
            {row("Technical Avail.",    plant.status === "online" ? "~98%+" : plant.status === "warning" ? "~80–95%" : "0%")}
            {row("Active Alerts",       plant.errors?.length || 0)}
            {row("Inverters",           inverters.length || plant.devices?.length || "—")}

            {secH("Device Information")}
            {(plant.devices || []).map((d, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                {row(`Inverter ${i + 1} Model`, d.model || "—")}
                {row(`Inverter ${i + 1} SN`,    d.deviceSn || "—")}
                {row(`Datalogger SN`,            d.datalogSn || "—")}
                {row(`Device Status`,            <StatusBadge status={d.status} />)}
                {row(`Last Update`,              formatDate(d.lastUpdate))}
              </div>
            ))}
            {!plant.devices?.length && row("Device", "No device data")}

            {secH("Location")}
            {row("City / State",        plant.city || "—")}
            {row("Country",             plant.country || "IN")}
            {row("Coordinates",         plant.latitude && plant.longitude ? `${Number(plant.latitude).toFixed(4)}°N, ${Number(plant.longitude).toFixed(4)}°E` : "—")}
          </div>
        </div>
      )}

      {/* ─── INVERTERS ──────────────────────────────── */}
      {tab === "inverters" && (
        <div>
          {inverters.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>No inverter data available</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
              {inverters.map((inv, i) => (
                <div key={i} style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", borderTop: `3px solid ${inv.status === "online" ? "#0E9B65" : inv.status === "warning" ? "#F7941D" : "#DC2626"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Inverter {i + 1}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{inv.model} · {inv.sn}</div>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                    {[
                      ["AC Power",     inv.power != null   ? `${fmtDec(inv.power)} kW`    : "—"],
                      ["AC Voltage",   inv.voltage_ac      ? `${fmtDec(inv.voltage_ac)} V` : "—"],
                      ["AC Current",   inv.current_ac      ? `${fmtDec(inv.current_ac)} A` : "—"],
                      ["DC Voltage",   inv.voltage_dc      ? `${fmtDec(inv.voltage_dc)} V` : "—"],
                      ["DC Current",   inv.current_dc      ? `${fmtDec(inv.current_dc)} A` : "—"],
                      ["Temperature",  inv.temperature     ? `${fmtDec(inv.temperature)} °C` : "—"],
                      ["Efficiency",   inv.efficiency      ? `${fmtDec(inv.efficiency)}%` : "—"],
                      ["Frequency",    inv.frequency       ? `${fmtDec(inv.frequency)} Hz` : "—"],
                      ["Today",        fmt(inv.todayEnergy) + " kWh"],
                      ["Lifetime",     fmt(Math.round((inv.totalEnergy||0)/1000)) + " MWh"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border-light)", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                    Updated: {formatDate(inv.lastUpdate)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── FINANCIAL & ENVIRONMENTAL ──────────────── */}
      {tab === "financial" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Financial */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, paddingBottom: 6, borderBottom: "2px solid var(--sb-orange)", display: "inline-block" }}>Financial Performance</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Today Revenue",    value: rupee(Math.round(plant.revenueToday || 0)),  sub: `@ ₹${plant.tariffPerKwh}/kWh` },
                { label: "Est. Monthly",     value: rupee(revenue30),  sub: "Based on today's gen" },
                { label: "Est. Annual",      value: rupee(revenue365), sub: "300 generation days" },
                { label: "Payback Period",   value: payback ? `${payback} yr` : "—", sub: "@ ₹45k/kWp install" },
              ].map(({ label, value, sub }) => (
                <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>
            {row("Tariff Rate",        `₹${plant.tariffPerKwh}/kWh`,     "Configured in Settings")}
            {row("Lifetime Revenue",   rupee(Math.round((plant.totalEnergy || 0) * (plant.tariffPerKwh || 4.5))), "Cumulative")}
            {row("LCOE Estimate",      "₹3.5–4.5/kWh",                   "IRENA India 2024 benchmark")}
            {row("Land Use (est.)",    plant.capacity ? `${((plant.capacity / 1000) * 32 * 0.4).toFixed(2)} acres` : "—", "~32 acres/10MW (NREL)")}
            {row("Plant Lifetime",     "25–40 years",                    "Typical utility-scale solar")}
            {row("Warranty (modules)", "25 yr performance, 10 yr product")}
          </div>

          {/* Environmental */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, paddingBottom: 6, borderBottom: "2px solid #0E9B65", display: "inline-block" }}>Environmental Impact (Lifetime)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { label: "CO₂ Avoided",       value: `${fmt(Math.round(co2Total/1000))} tonnes`, sub: "Grid emission factor: 0.82 kg/kWh", icon: "🌍" },
                { label: "Equivalent Trees",   value: `${fmt(trees)}`,    sub: "@ 21 kg CO₂/tree/yr",          icon: "🌳" },
                { label: "Coal Saved",         value: `${coal} tonnes`,   sub: "2.42 kg CO₂ per kg coal",       icon: "⛏" },
                { label: "Homes Powered",      value: `${fmt(homes)} yr`, sub: "1,200 kWh/yr per Indian home",  icon: "🏠" },
              ].map(({ label, value, sub, icon }) => (
                <div key={label} style={{ background: "#E8F8F1", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 11, color: "#065F46", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#065F46" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "#6EE7B7", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>
            {row("CO₂ Factor",          `${plant.tariffPerKwh ? "0.82" : "—"} kg/kWh`, "India grid average (CEA 2023)")}
            {row("CO₂ Avoided Today",   `${Math.round((plant.todayEnergy || 0) * 0.82)} kg`)}
            {row("SOx Avoided (est.)",  `${Math.round((plant.totalEnergy || 0) * 0.00035)} kg`, "Grid displacement benefit")}
            {row("NOx Avoided (est.)",  `${Math.round((plant.totalEnergy || 0) * 0.00052)} kg`)}
            {row("Water Saved",         `${fmt(Math.round((plant.totalEnergy || 0) * 2))} litres`, "vs thermal: ~2L/kWh (cooling)")}
            <div style={{ marginTop: 20, padding: "14px 16px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0", fontSize: 12, color: "#065F46" }}>
              🌱 This plant has prevented <strong>{fmt(Math.round(co2Total/1000))} tonnes of CO₂</strong> — equivalent to taking <strong>{fmt(Math.round(co2Total/1000/4.6))} cars off the road</strong> for a year.
            </div>
          </div>
        </div>
      )}

      {/* ─── CHARTS ─────────────────────────────────── */}
      {tab === "timeseries" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 20 }}>
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Generation Over Time</div>
            <TimeSeriesChart plantId={plant.id} defaultRange="1w" />
          </div>
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Performance Profile</div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={80}>
                <PolarGrid stroke="var(--color-border-light)" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <Radar name="Plant" dataKey="value" stroke="var(--sb-orange)" fill="var(--sb-orange)" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── ALERTS ─────────────────────────────────── */}
      {tab === "alerts" && <AlertsTable alarms={plant.errors || []} />}

      {/* ─── 7-DAY HISTORY ──────────────────────────── */}
      {tab === "history" && (
        <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>7-Day Generation History</div>
          {historyData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={historyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} kWh`} />
                <Tooltip formatter={(v) => [`${v} kWh`, "Energy"]} />
                <Bar dataKey="energy" name="Energy (kWh)" fill="var(--sb-orange)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: 40 }}>No history data</div>
          )}
          {historyData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 20 }}>
              {[
                { label: "7-Day Total",    value: `${fmt(Math.round(historyData.reduce((s, d) => s + d.energy, 0)))} kWh` },
                { label: "Daily Average",  value: `${fmt(Math.round(historyData.reduce((s, d) => s + d.energy, 0) / 7))} kWh` },
                { label: "Best Day",       value: `${fmt(Math.max(...historyData.map((d) => d.energy)))} kWh` },
                { label: "Est. 7-Day Rev", value: rupee(Math.round(historyData.reduce((s, d) => s + d.energy, 0) * (plant.tariffPerKwh || 4.5))) },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
