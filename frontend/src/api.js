const TOKEN_KEY = "sb_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Only treat as "session expired" if a token was present (it expired/was invalid)
    // Unauthenticated requests (no token) are handled by ProtectedRoute
    if (token) {
      clearToken();
      window.dispatchEvent(new Event("auth:logout"));
    }
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get  = (path)        => request("GET",    path);
const post = (path, body)  => request("POST",   path, body);
export const put  = (path, body)  => request("PUT",    path, body);
const del  = (path)        => request("DELETE", path);

// Auth
export const login    = (username, password) => post("/api/auth/login", { username, password });
export const getMe    = ()                   => get("/api/auth/me");

// Plants
export const getPlants       = ()           => get("/api/plants");
export const getPlant        = (id)         => get(`/api/plants/${id}`);
export const getTimeseries   = (id, params) => {
  const qs = new URLSearchParams(params).toString();
  return get(`/api/plants/${id}/timeseries?${qs}`);
};

// Users (admin)
export const getUsers    = ()           => get("/api/admin/users");
export const createUser  = (data)       => post("/api/admin/users", data);
export const updateUser  = (id, data)   => put(`/api/admin/users/${id}`, data);
export const deleteUser  = (id)         => del(`/api/admin/users/${id}`);

// Cache
export const clearCache = () => post("/api/cache/clear");

// Fleet analytics
export const getFleetAnalytics = (range = "30d") => get(`/api/fleet/analytics?range=${range}`);

// Notifications
export const getNotifications = () => get("/api/notifications");

// Comparison
export const comparePlants = (ids) => get(`/api/plants/compare?ids=${ids.join(",")}`);

// Inverters
export const getInverters = (plantId) => get(`/api/plants/${plantId}/inverters`);

// Settings
export const getSettings  = ()     => get("/api/settings");
export const saveSettings = (data) => put("/api/settings", data);
