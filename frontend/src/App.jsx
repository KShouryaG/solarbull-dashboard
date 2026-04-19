import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { PlantProvider } from "./context/PlantContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import PlantDetail from "./pages/PlantDetail.jsx";
import Rankings from "./pages/Rankings.jsx";
import Reports from "./pages/Reports.jsx";
import UserManagement from "./pages/UserManagement.jsx";
import MapView from "./pages/MapView.jsx";
import Analytics from "./pages/Analytics.jsx";
import Compare from "./pages/Compare.jsx";
import Notifications from "./pages/Notifications.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={
          <ProtectedRoute>
            <PlantProvider>
              <Layout />
            </PlantProvider>
          </ProtectedRoute>
        }>
          <Route index               element={<Dashboard />} />
          <Route path="plants/:id"   element={<PlantDetail />} />
          <Route path="map"          element={<MapView />} />
          <Route path="rankings"     element={<Rankings />} />
          <Route path="analytics"    element={<Analytics />} />
          <Route path="compare"      element={<Compare />} />
          <Route path="reports"      element={<Reports />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings"     element={<Settings />} />
          <Route path="users"        element={
            <ProtectedRoute adminOnly>
              <UserManagement />
            </ProtectedRoute>
          } />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
