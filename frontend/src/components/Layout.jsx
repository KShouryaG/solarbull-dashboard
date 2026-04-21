import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Chatbot from "./Chatbot.jsx";

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isTablet, setIsTablet] = useState(window.innerWidth >= 768 && window.innerWidth < 1100);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      setIsMobile(w < 768);
      setIsTablet(w >= 768 && w < 1100);
      if (w >= 1100) setSidebarOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const sidebarWidth = isMobile ? 0 : isTablet ? 64 : 220;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 99,
            background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
          }}
        />
      )}

      <Sidebar
        collapsed={isTablet && !sidebarOpen}
        mobileOpen={isMobile && sidebarOpen}
        isMobile={isMobile}
        onClose={() => setSidebarOpen(false)}
      />

      <main style={{
        flex: 1,
        marginLeft: isMobile ? 0 : sidebarWidth,
        minHeight: "100vh",
        background: "var(--color-background-page)",
        padding: isMobile ? "16px 14px" : isTablet ? "24px 20px" : "28px 32px",
        overflowX: "hidden",
        transition: "margin-left 0.25s ease",
      }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            marginBottom: 16, paddingBottom: 12,
            borderBottom: "1px solid var(--color-border-light)",
          }}>
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: "var(--color-background-sidebar)",
                border: "none", borderRadius: 8,
                width: 38, height: 38, padding: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 5,
                flexShrink: 0,
              }}
            >
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ display: "block", width: 18, height: 2, background: "#fff", borderRadius: 1 }} />
              ))}
            </button>
            <img src="/logo.png" alt="SolarBull" style={{ height: 28, filter: "none", objectFit: "contain" }} />
          </div>
        )}

        <Outlet />
      </main>

      <Chatbot />
    </div>
  );
}
