import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

const NAV_GROUPS = [
  {
    label: "Monitoring",
    items: [
      { to: "/",           label: "Dashboard",      icon: "⊞", end: true },
      { to: "/map",        label: "Map View",        icon: "🗺" },
      { to: "/notifications", label: "Alerts",       icon: "🔔", badge: "notifications" },
    ],
  },
  {
    label: "Performance",
    items: [
      { to: "/analytics",  label: "Analytics",      icon: "📈" },
      { to: "/rankings",   label: "Rankings",        icon: "⬆" },
      { to: "/compare",    label: "Compare",         icon: "⚖" },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/reports",    label: "Reports",         icon: "📊" },
    ],
  },
];

const ADMIN_ITEMS = [
  { to: "/users",    label: "User Management", icon: "👥" },
  { to: "/settings", label: "Settings",        icon: "⚙" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const linkStyle = (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: "var(--border-radius-md)",
    color: active ? "#fff" : "rgba(255,255,255,0.65)",
    background: active ? "rgba(247,148,29,0.22)" : "transparent",
    borderLeft: active ? "3px solid var(--sb-orange)" : "3px solid transparent",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    transition: "all 0.12s",
    cursor: "pointer",
  });

  const groupLabel = (label) => (
    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(255,255,255,0.3)", padding: "14px 12px 5px", marginTop: 4 }}>
      {label}
    </div>
  );

  return (
    <aside style={{
      width: 220,
      minHeight: "100vh",
      background: "var(--color-background-sidebar)",
      display: "flex",
      flexDirection: "column",
      position: "fixed",
      top: 0, left: 0, bottom: 0,
      zIndex: 100,
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <img src="/logo.png" alt="SolarBull" style={{ height: 34, maxWidth: "100%", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 4, letterSpacing: 1 }}>ENERGY MONITORING</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "4px 8px" }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {groupLabel(group.label)}
            {group.items.map(({ to, label, icon, end }) => (
              <NavLink key={to} to={to} end={end} style={({ isActive }) => linkStyle(isActive)}>
                <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{icon}</span>
                {label}
              </NavLink>
            ))}
          </div>
        ))}

        {user?.role === "admin" && (
          <div>
            {groupLabel("Admin")}
            {ADMIN_ITEMS.map(({ to, label, icon }) => (
              <NavLink key={to} to={to} style={({ isActive }) => linkStyle(isActive)}>
                <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{icon}</span>
                {label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* User footer */}
      <div style={{ padding: "10px 8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ padding: "10px 12px", marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 1 }}>{user?.role}</div>
        </div>
        <button
          onClick={() => { logout(); navigate("/login"); }}
          style={{ ...linkStyle(false), width: "100%", border: "none", background: "rgba(255,255,255,0.06)", justifyContent: "flex-start" }}
        >
          <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>↩</span>
          Log out
        </button>
      </div>
    </aside>
  );
}
