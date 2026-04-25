const TOKEN_KEY = "sb_token";
const API_BASE  = import.meta.env.VITE_API_URL || "";

// ── In-memory API cache (survives navigation, cleared on logout) ────────────
const _cache = {};
function _cachedGet(path, ttlMs = 5 * 60 * 1000) {
  const hit = _cache[path];
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return get(path).then((d) => { _cache[path] = { data: d, ts: Date.now() }; return d; });
}
export function clearApiCache() { Object.keys(_cache).forEach((k) => delete _cache[k]); }

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

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const errData = await res.json().catch(() => ({}));
    // On the login endpoint, a 401 means wrong credentials — surface the real message
    if (path.includes("/auth/login")) {
      throw new Error(errData.error || "Invalid credentials");
    }
    // For all other endpoints, a 401 means the session token expired
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

// Fleet analytics — cached 5 min per range
export const getFleetAnalytics = (range = "30d") => _cachedGet(`/api/fleet/analytics?range=${range}`);

// Notifications — cached 2 min
export const getNotifications = () => _cachedGet("/api/notifications", 2 * 60 * 1000);

// Comparison
export const comparePlants = (ids) => get(`/api/plants/compare?ids=${ids.join(",")}`);

// Inverters
export const getInverters = (plantId) => get(`/api/plants/${plantId}/inverters`);

// Settings
export const getSettings  = ()     => get("/api/settings");
export const saveSettings = (data) => put("/api/settings", data);

// Period comparison (single plant)
export const getPeriodCompare = (plantId, p) => {
  const qs = new URLSearchParams(p).toString();
  return get(`/api/plants/${plantId}/period-compare?${qs}`);
};

// Multi-plant historical comparison
export const getCompareHistory = (ids, start, end, granularity = "daily") =>
  get(`/api/compare/history?ids=${ids.join(",")}&start=${start}&end=${end}&granularity=${granularity}`);

// Alert history
export const getAlertHistory = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString();
  return get(`/api/alerts/history${qs ? "?" + qs : ""}`);
};

// AI Chatbot
export const sendChatMessage = (question) => post("/api/chat", { question });

// Power curve (intraday kW)
export const getPowerCurve = (plantId, date) => {
  const qs = date ? `?date=${date}` : "";
  return get(`/api/plants/${plantId}/power-curve${qs}`);
};

// Delta KPIs (today vs yesterday, this month vs last)
export const getPlantKPIs = (plantId) => get(`/api/plants/${plantId}/kpis`);

// Monthly & yearly chart data
export const getMonthlyChart = (plantId) => get(`/api/plants/${plantId}/monthly-chart`);

// SOLARBULL-IMPROVEMENT: Task 11 — generation history with variable day range
export const getPlantHistory = (plantId, days = 7) => get(`/api/plants/${plantId}/history?days=${days}`);

// SOLARBULL-IMPROVEMENT: Task 7 — health / last-sync status (no auth required)
export const getHealth = () => fetch(`${API_BASE}/api/health`).then((r) => r.json()).catch(() => null);
