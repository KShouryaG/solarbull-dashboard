import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";

export default function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{
        flex: 1,
        marginLeft: 220,
        minHeight: "100vh",
        background: "var(--color-background-page)",
        padding: "28px 32px",
        overflowX: "hidden",
      }}>
        <Outlet />
      </main>
    </div>
  );
}
