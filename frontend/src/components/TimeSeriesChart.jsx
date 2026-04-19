import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { getTimeseries } from "../api.js";

const RANGES = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "1y", label: "1Y" },
];

const CHART_TYPES = ["area", "line", "bar"];

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid var(--color-border-light)", borderRadius: 8, padding: "8px 12px", boxShadow: "var(--shadow-md)", fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--color-text-secondary)" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {Number(p.value).toLocaleString("en-IN")} {unit}
        </div>
      ))}
    </div>
  );
};

export default function TimeSeriesChart({ plantId, defaultRange = "1d" }) {
  const [range,     setRange]     = useState(defaultRange);
  const [chartType, setChartType] = useState("area");
  const [data,      setData]      = useState([]);
  const [unit,      setUnit]      = useState("kWh");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  const load = useCallback(async (r) => {
    setLoading(true);
    setError("");
    try {
      const res = await getTimeseries(plantId, { range: r, metric: "energy" });
      setData(res.data || []);
      setUnit(res.unit || "kWh");
    } catch (e) {
      setError(e.message);
      setData([]);
    }
    setLoading(false);
  }, [plantId]);

  useEffect(() => { if (plantId) load(range); }, [plantId, range, load]);

  const chartData = data.map((d) => ({ name: d.ts?.slice?.(0, 10) || d.ts, value: d.value }));
  const color     = "#F7941D";
  const gradient  = "url(#sbGrad)";

  const renderChart = () => {
    if (loading) return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 220 }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
    if (error) return <div style={{ textAlign: "center", color: "var(--color-text-danger)", padding: "40px 0", fontSize: 13 }}>{error}</div>;
    if (!chartData.length) return (
      <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: "40px 0", fontSize: 13 }}>
        No data available for this range
      </div>
    );

    const common = {
      data: chartData,
      margin: { top: 5, right: 10, left: 0, bottom: 0 },
    };
    const xAxis = <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />;
    const yAxis = <YAxis tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v} />;
    const grid  = <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />;
    const tip   = <Tooltip content={<CustomTooltip unit={unit} />} />;

    if (chartType === "bar") return (
      <BarChart {...common}>
        <defs><linearGradient id="sbGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.9}/><stop offset="100%" stopColor={color} stopOpacity={0.5}/></linearGradient></defs>
        {grid}{xAxis}{yAxis}{tip}
        <Bar dataKey="value" fill={gradient} radius={[4, 4, 0, 0]} />
      </BarChart>
    );
    if (chartType === "line") return (
      <LineChart {...common}>
        {grid}{xAxis}{yAxis}{tip}
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: color }} />
      </LineChart>
    );
    // area (default)
    return (
      <AreaChart {...common}>
        <defs>
          <linearGradient id="sbGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {grid}{xAxis}{yAxis}{tip}
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={gradient} dot={false} activeDot={{ r: 4, fill: color }} />
      </AreaChart>
    );
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        {/* Range selector */}
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map(({ key, label }) => (
            <button key={key} onClick={() => { setRange(key); }}
              style={{
                padding: "5px 14px", fontSize: 12, fontWeight: range === key ? 600 : 400,
                background: range === key ? "var(--sb-orange)" : "var(--color-background-secondary)",
                color: range === key ? "#fff" : "var(--color-text-secondary)",
                border: "none", borderRadius: 6,
              }}>
              {label}
            </button>
          ))}
        </div>
        {/* Chart type */}
        <div style={{ display: "flex", gap: 4 }}>
          {CHART_TYPES.map((t) => (
            <button key={t} onClick={() => setChartType(t)}
              style={{
                padding: "5px 12px", fontSize: 12, fontWeight: chartType === t ? 600 : 400,
                background: chartType === t ? "var(--sb-blue)" : "var(--color-background-secondary)",
                color: chartType === t ? "#fff" : "var(--color-text-secondary)",
                border: "none", borderRadius: 6, textTransform: "capitalize",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
