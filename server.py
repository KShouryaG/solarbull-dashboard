"""
SolarBull Energy - Sungrow iSolarCloud Dashboard Backend
Multi-user platform: JWT auth, per-client plant assignment, computed KPIs, time-series.
"""

import os
import json
import time
import sqlite3
import logging
import traceback
from datetime import datetime, timedelta
from functools import wraps
from threading import Lock
from concurrent.futures import ThreadPoolExecutor, as_completed

import bcrypt
import jwt as pyjwt
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SUNGROW_USERNAME = os.getenv("SUNGROW_USERNAME", "")
SUNGROW_PASSWORD = os.getenv("SUNGROW_PASSWORD", "")
SUNGROW_APPKEY   = os.getenv("SUNGROW_APPKEY", "")
SUNGROW_APPSECRET = os.getenv("SUNGROW_APPSECRET", "")

SUNGROW_SERVERS = {
    "international": "https://gateway.isolarcloud.com.hk",
    "china":         "https://gateway.isolarcloud.com",
    "europe":        "https://gateway.isolarcloud.eu",
    "australia":     "https://augateway.isolarcloud.com",
}
SUNGROW_SERVER = os.getenv("SUNGROW_SERVER", SUNGROW_SERVERS["international"])

CACHE_TTL  = int(os.getenv("CACHE_TTL", "600"))   # 10 min default; plant list changes slowly
PORT       = int(os.getenv("PORT", "8080"))
USE_DEMO   = os.getenv("USE_DEMO", "false").lower() == "true"

# SOLARBULL-IMPROVEMENT: Task 1 — require sensitive env vars, no silent fallbacks
def _require_env(name, hint=""):
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Required environment variable '{name}' is not set. {hint}"
        )
    return val

def _optional_env(name, default, warn_if_default=False):
    val = os.getenv(name, default)
    if warn_if_default and val == default:
        logging.getLogger("solarbull").warning(
            "Using default value for %s — set this env var for production.", name
        )
    return val

# Auth / DB
JWT_SECRET        = _require_env("JWT_SECRET", "Set to a long random string, e.g. openssl rand -hex 32")
JWT_EXPIRY_HOURS  = int(os.getenv("JWT_EXPIRY_HOURS", "24"))
DB_PATH           = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "solarbull.db"))
ADMIN_USERNAME    = _optional_env("ADMIN_USERNAME", "shourya", warn_if_default=True)
ADMIN_PASSWORD    = _require_env("ADMIN_PASSWORD", "Set the admin dashboard login password.")
ADMIN_NAME        = os.getenv("ADMIN_NAME", "SolarBull Admin")
ADMIN_EMAIL       = _require_env("ADMIN_EMAIL", "Set the admin email address.")

# Solar KPI constants (India defaults)
PEAK_SUN_HOURS  = float(os.getenv("PEAK_SUN_HOURS", "5.5"))
TARIFF_PER_KWH  = float(os.getenv("TARIFF_PER_KWH", "4.5"))
CO2_KG_PER_KWH  = float(os.getenv("CO2_KG_PER_KWH", "0.82"))

# Benchmarks for grading
PR_EXCELLENT = 0.80
PR_GOOD      = 0.70
PR_FAIR      = 0.55

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("solarbull")

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
# SOLARBULL-IMPROVEMENT: Task 1 — CORS restricted to ALLOWED_ORIGINS env var
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
CORS(app, origins=[o.strip() for o in _allowed_origins])

# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL,
            password_hash TEXT    NOT NULL,
            name          TEXT    NOT NULL,
            email         TEXT    DEFAULT '',
            role          TEXT    NOT NULL DEFAULT 'client',
            plant_ids     TEXT    NOT NULL DEFAULT '[]',
            created_at    TEXT    NOT NULL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    # Seed default settings
    defaults = {
        "tariff_per_kwh":   "4.5",
        "peak_sun_hours":   "5.5",
        "co2_factor":       "0.82",
        "pr_excellent":     "0.80",
        "pr_good":          "0.70",
        "pr_fair":          "0.55",
        "currency":         "INR",
        "timezone":         "Asia/Kolkata",
        "company_name":     "SolarBull Energy",
    }
    for k, v in defaults.items():
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
    c.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT NOT NULL,
            plant_id   TEXT NOT NULL,
            data       TEXT NOT NULL,
            UNIQUE(date, plant_id)
        )
    """)
    # Seed admin
    existing = c.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,)).fetchone()
    if not existing:
        pw_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
        c.execute(
            "INSERT INTO users (username,password_hash,name,email,role,plant_ids,created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (ADMIN_USERNAME, pw_hash, ADMIN_NAME, ADMIN_EMAIL,
             "admin", "[]", datetime.now().isoformat())
        )
        log.info("Admin user '%s' created.", ADMIN_USERNAME)
    conn.commit()
    conn.close()

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------
def make_token(user_id: int, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    return pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])

def require_role(role=None):
    """Decorator factory. role=None means any authenticated user."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return jsonify({"error": "Missing or invalid Authorization header"}), 401
            token = auth[7:]
            try:
                payload = decode_token(token)
            except pyjwt.ExpiredSignatureError:
                return jsonify({"error": "Token expired"}), 401
            except pyjwt.PyJWTError as e:
                return jsonify({"error": f"Invalid token: {e}"}), 401

            conn = get_db()
            user = conn.execute("SELECT * FROM users WHERE id=?", (int(payload["sub"]),)).fetchone()
            conn.close()
            if not user:
                return jsonify({"error": "User not found"}), 401
            user = dict(user)
            if role and user.get("role") != role:
                return jsonify({"error": f"Requires role: {role}"}), 403
            kwargs["current_user"] = user
            return f(*args, **kwargs)
        return wrapper
    return decorator

# ---------------------------------------------------------------------------
# Sungrow iSolarCloud client
# ---------------------------------------------------------------------------
class SungrowClient:
    def __init__(self):
        self.session   = requests.Session()
        self.token     = None
        self.user_id   = None
        self.logged_in = False
        self._cache    = {}
        self._lock     = Lock()
        self.server    = SUNGROW_SERVER

    def _build_headers(self):
        return {
            "Content-Type": "application/json;charset=UTF-8",
            "x-access-key": SUNGROW_APPSECRET,
            "sys_code": "901",
        }

    def _post(self, endpoint, payload):
        url     = f"{self.server}{endpoint}"
        headers = self._build_headers()
        payload = dict(payload or {})
        payload["appkey"] = SUNGROW_APPKEY
        if self.token:
            payload["token"] = self.token
        try:
            resp = self.session.post(url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                code = data.get("result_code", data.get("code"))
                if code and str(code) not in ("1", "0", "200"):
                    msg = data.get("result_msg", data.get("message", "Unknown"))
                    log.warning("API error %s on %s: %s", code, endpoint, msg)
            return data
        except requests.exceptions.HTTPError as e:
            log.error("HTTP error on %s: %s", endpoint, e)
            raise
        except Exception as e:
            log.error("Request failed on %s: %s", endpoint, e)
            raise

    def login(self):
        if not SUNGROW_USERNAME or not SUNGROW_PASSWORD:
            raise ValueError("SUNGROW_USERNAME and SUNGROW_PASSWORD must be set")
        if not SUNGROW_APPKEY:
            raise ValueError("SUNGROW_APPKEY must be set")
        log.info("Logging in to iSolarCloud as %s ...", SUNGROW_USERNAME)
        result = self._post("/openapi/login", {
            "user_account": SUNGROW_USERNAME,
            "user_password": SUNGROW_PASSWORD,
            "login_type": "1",
            "appkey": SUNGROW_APPKEY,
        })
        if not isinstance(result, dict):
            raise RuntimeError(f"Unexpected login response: {result}")
        code = str(result.get("result_code", ""))
        if code not in ("1", "0"):
            raise RuntimeError(f"Login failed ({code}): {result.get('result_msg','')}")
        data = result.get("result_data", result)
        self.token    = data.get("token", data.get("access_token"))
        self.user_id  = data.get("user_id", data.get("userId"))
        if not self.token:
            raise RuntimeError(f"No token in response: {json.dumps(result)[:500]}")
        self.logged_in = True
        log.info("Login successful.")
        return {"token": self.token, "user_id": self.user_id}

    def ensure_login(self):
        if not self.logged_in:
            self.login()

    def _cached(self, key, fetcher, ttl=None):
        ttl = ttl or CACHE_TTL
        with self._lock:
            if key in self._cache:
                val, ts = self._cache[key]
                if time.time() - ts < ttl:
                    return val
        try:
            val = fetcher()
        except Exception as e:
            with self._lock:
                if key in self._cache:
                    log.warning("Fetch failed, returning stale: %s", e)
                    return self._cache[key][0]
            raise
        with self._lock:
            self._cache[key] = (val, time.time())
        return val

    def clear_cache(self, key=None):
        with self._lock:
            if key:
                self._cache.pop(key, None)
            else:
                self._cache.clear()

    def get_plant_list(self):
        self.ensure_login()
        def fetch():
            result = self._post("/openapi/getPowerStationList", {"curPage": 1, "size": 200})
            data = result.get("result_data", result) if isinstance(result, dict) else {}
            return data.get("pageList", data.get("plants", data.get("datas", [])))
        return self._cached("plant_list", fetch)

    def get_plant_detail(self, ps_id):
        self.ensure_login()
        def fetch():
            result = self._post("/openapi/getPowerStationDetail", {"ps_id": ps_id})
            return result.get("result_data", result) if isinstance(result, dict) else {}
        return self._cached(f"plant_detail:{ps_id}", fetch)

    def get_plant_realtime(self, ps_ids):
        self.ensure_login()
        ps_id_str = ",".join(str(p) for p in ps_ids) if isinstance(ps_ids, (list, tuple)) else str(ps_ids)
        def fetch():
            result = self._post("/openapi/getPowerStationRealTimeData", {"ps_id_list": ps_id_str})
            data = result.get("result_data") if isinstance(result, dict) else None
            return data if isinstance(data, dict) else {}
        return self._cached(f"plant_realtime:{ps_id_str}", fetch, ttl=120)

    def get_device_list(self, ps_id):
        self.ensure_login()
        def fetch():
            result = self._post("/openapi/getDeviceList", {"ps_id": ps_id, "curPage": 1, "size": 100})
            data = result.get("result_data", result) if isinstance(result, dict) else {}
            return data.get("pageList", data.get("devices", []))
        return self._cached(f"devices:{ps_id}", fetch)

    def get_plant_generation_history(self, ps_id, days=7):
        self.ensure_login()
        def fetch():
            history = []
            for i in range(days):
                d = datetime.now() - timedelta(days=days - 1 - i)
                date_str = d.strftime("%Y%m%d")
                try:
                    result = self._post("/openapi/getPowerChartData", {
                        "ps_id": ps_id, "date_id": date_str,
                        "date_type": "1", "points_code": "p83022",
                    })
                    data = result.get("result_data", {}) if isinstance(result, dict) else {}
                    total = 0
                    if "data_points" in data:
                        total = sum(float(p.get("value", 0) or 0) for p in data["data_points"])
                    history.append({"date": d.strftime("%Y-%m-%d"), "energy": round(total, 1)})
                except Exception as e:
                    log.warning("History failed for %s %s: %s", ps_id, date_str, e)
                    history.append({"date": d.strftime("%Y-%m-%d"), "energy": 0})
            return history
        return self._cached(f"plant_history:{ps_id}", fetch, ttl=600)

    def get_chart_data(self, ps_id, date_id, date_type="1", points_code="p83022"):
        """Fetch chart data with caching."""
        self.ensure_login()
        cache_key = f"chart:{ps_id}:{date_type}:{date_id}:{points_code}"
        def fetch():
            result = self._post("/openapi/getPowerChartData", {
                "ps_id": ps_id, "date_id": date_id,
                "date_type": date_type, "points_code": points_code,
            })
            return result.get("result_data") if isinstance(result, dict) else None
        ttl = 300 if date_type == "1" else 3600
        return self._cached(cache_key, fetch, ttl=ttl)

    def get_device_realtime(self, ps_id, device_sn=None):
        """Get real-time device data (inverter parameters)."""
        self.ensure_login()
        cache_key = f"device_rt:{ps_id}:{device_sn or 'all'}"
        def fetch():
            payload = {"ps_id": ps_id}
            if device_sn:
                payload["device_sn"] = device_sn
            result = self._post("/openapi/getDeviceRealTimeData", payload)
            data = result.get("result_data") if isinstance(result, dict) else None
            return data if isinstance(data, dict) else {}
        return self._cached(cache_key, fetch, ttl=120)

    def get_plant_energy_overview(self, ps_id):
        """Get comprehensive energy overview for a plant."""
        self.ensure_login()
        cache_key = f"energy_overview:{ps_id}"
        def fetch():
            result = self._post("/openapi/getPowerStationDetail", {"ps_id": ps_id})
            return result.get("result_data", {}) if isinstance(result, dict) else {}
        return self._cached(cache_key, fetch, ttl=300)

    def get_device_alarms(self, ps_id=None):
        self.ensure_login()
        def fetch():
            payload = {
                "curPage": 1, "size": 100,
                "start_time": (datetime.now() - timedelta(days=7)).strftime("%Y%m%d%H%M%S"),
                "end_time": datetime.now().strftime("%Y%m%d%H%M%S"),
            }
            if ps_id:
                payload["ps_id"] = ps_id
            result = self._post("/openapi/getDeviceFaultList", payload)
            data = result.get("result_data") if isinstance(result, dict) else None
            if not isinstance(data, dict):
                return []
            return data.get("pageList", data.get("alarms", []))
        return self._cached(f"alarms:{ps_id or 'all'}", fetch, ttl=300)

    def get_all_plants_summary(self):
        """Fast summary: 2 API calls total (plant list + bulk alarms). No per-plant calls."""
        return self._cached("all_plants_summary", self._fetch_all_plants_summary, ttl=300)

    def _fetch_all_plants_summary(self):
        t0 = time.time()
        # Run plant list + bulk alarms fetch in parallel — 2 calls total
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_plants = ex.submit(self.get_plant_list)
            f_alarms = ex.submit(self.get_device_alarms)  # no ps_id = all plants
            plants_raw = f_plants.result()
            alarms_raw = f_alarms.result()

        if not isinstance(plants_raw, list):
            log.warning("Plant list not a list: %s", type(plants_raw))
            return []

        # Index alarms by ps_id for O(1) lookup
        alarm_map = {}
        if isinstance(alarms_raw, list):
            for a in alarms_raw:
                pid = str(a.get("ps_id", a.get("plant_id", "")))
                alarm_map.setdefault(pid, []).append(a)

        summaries = []
        for plant in plants_raw:
            pid = str(plant.get("ps_id", plant.get("psId", "")))
            if not pid:
                continue

            raw_month = plant.get("month_energy")
            month_energy = _sg_val(raw_month) if raw_month is not None else None

            # Device model from list data (avoids per-plant getDeviceList call)
            device_model = plant.get("device_model_code", plant.get("device_model_name", ""))
            device_sn    = plant.get("device_sn", "")

            plant_status = _parse_plant_status(plant.get("ps_status", 1))
            today_energy_val = _sg_val(plant.get("today_energy", 0))
            # ps_status=0 at night is normal standby — treat as online if the plant generated today
            if plant_status == "offline" and today_energy_val and today_energy_val > 0:
                plant_status = "online"

            # Revenue: Sungrow stores income in rupees (卢比) or 万卢比 (10k rupees)
            today_income_raw = plant.get("today_income")
            total_income_raw = plant.get("total_income")
            year_income_raw  = plant.get("year_income")

            # Equivalent hours = specific yield from Sungrow (kWh/kWp)
            equiv_hours = _sg_val(plant.get("equivalent_hour"), nullable=True)

            # CO2 fields: co2_reduce = today, co2_reduce_total = lifetime
            # SOLARBULL-IMPROVEMENT: Task 4 — normalise to tonnes
            co2_today    = _normalise_co2_tonnes(_sg_val(plant.get("co2_reduce"), nullable=True))
            co2_lifetime = _normalise_co2_tonnes(_sg_val(plant.get("co2_reduce_total",
                                              plant.get("co2_reduce", 0))))

            # Last data update timestamp
            last_updated = (plant.get("today_energy_update_time") or
                            plant.get("curr_power_update_time") or "")

            summary = {
                "id":           pid,
                "name":         plant.get("ps_name", f"Plant {pid}"),
                "address":      plant.get("ps_location", ""),
                "city":         _extract_city(plant.get("ps_location", "")),
                "country":      plant.get("country", "IN"),
                "capacity":     _sg_val(plant.get("total_capcity", 0)),
                "status":       plant_status,
                "todayEnergy":  today_energy_val,
                "monthEnergy":  month_energy,
                "totalEnergy":  _sg_val(plant.get("total_energy", 0)),
                "currentPower": _sg_val(plant.get("curr_power", 0), nullable=True),
                "co2":          co2_lifetime,
                "co2Today":     co2_today,
                "latitude":     plant.get("latitude", ""),
                "longitude":    plant.get("longitude", ""),
                "installDate":  plant.get("install_date", ""),
                "lastUpdated":  last_updated,
                # Revenue from iSolarCloud (actual configured tariff)
                "todayIncomeActual": _sg_val(today_income_raw, nullable=True),
                "totalIncomeActual": _sg_val(total_income_raw, nullable=True),
                "yearIncomeActual":  _sg_val(year_income_raw, nullable=True),
                # Specific yield (equivalent sun hours)
                "equivalentHours": equiv_hours,
                # Fault/alarm counts
                "alarmCount":   plant.get("alarm_count", 0),
                "faultCount":   plant.get("fault_count", 0),
                "faultStatus":  plant.get("ps_fault_status"),
                # Grid
                "gridConnected": plant.get("grid_connection_status") == 1,
                "devices": [{
                    "deviceSn":   device_sn,
                    "datalogSn":  plant.get("communication_dev_sn", ""),
                    "deviceType": "Inverter",
                    "model":      device_model,
                    "status":     plant_status,
                    "lastUpdate": plant.get("rel_time", ""),
                }] if device_sn or device_model else [],
                "errors": [],
            }

            # Attach alarms from bulk fetch
            for a in alarm_map.get(pid, []):
                code = str(a.get("fault_code", a.get("alarm_code", "E01"))).upper()
                info = lookup_error(code)
                summary["errors"].append({
                    "code":      code,
                    "desc":      a.get("fault_name", a.get("alarm_name", info.get("desc", "Unknown"))),
                    "severity":  info.get("severity", "medium"),
                    "fix":       info.get("fix", "Contact service center."),
                    "timestamp": a.get("fault_time", a.get("begin_time", datetime.now().isoformat())),
                    "deviceSn":  a.get("device_sn", ""),
                })

            # Per-plant tariff from API (ps_price_kwh field, if present in list data)
            plant_tariff = _safe_float(plant.get("ps_price_kwh") or
                                       plant.get("price_kwh") or
                                       plant.get("electricity_price"), 0.0) or None
            compute_plant_stats(summary, tariff=plant_tariff)
            summaries.append(summary)

        log.info("Plant summary built: %d plants in %.2fs", len(summaries), time.time() - t0)
        return summaries

    def get_plant_detail_full(self, ps_id):
        """Detailed single-plant data including per-plant device list and alarm history."""
        def fetch():
            with ThreadPoolExecutor(max_workers=3) as ex:
                f_detail  = ex.submit(self.get_plant_detail, ps_id)
                f_devices = ex.submit(self.get_device_list, ps_id)
                f_alarms  = ex.submit(self.get_device_alarms, ps_id)
                f_history = ex.submit(self.get_plant_generation_history, ps_id, 7)
                detail  = f_detail.result()
                devices = f_devices.result()
                alarms  = f_alarms.result()
                history = f_history.result()
            return {"detail": detail, "devices": devices, "alarms": alarms, "history": history}
        return self._cached(f"plant_full:{ps_id}", fetch, ttl=300)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _safe_float(val, default=0.0):
    if val is None or val == "" or val == "--":
        return default
    try:
        return round(float(str(val).replace(",", "")), 2)
    except (ValueError, TypeError):
        return default

def _sg_val(field, default=0.0, nullable=False):
    if field is None:
        return None if nullable else default
    if isinstance(field, dict):
        raw  = field.get("value", 0)
        unit = str(field.get("unit", ""))
        if nullable and (raw == "--" or raw is None or raw == ""):
            return None
        num = _safe_float(raw, default)
        if "万" in unit:
            num = round(num * 10000, 2)
        return num
    if nullable and (field == "--" or field == ""):
        return None
    return _safe_float(field, default)

def _extract_city(address):
    """Extract city from a full address string like '47, Nandagiri Hills, Jubilee Hills, Hyderabad, Telangana 500033, India'."""
    if not address:
        return ""
    # Remove postal code and country suffix, then take the last meaningful token
    import re
    cleaned = re.sub(r"\s*\d{5,6}\s*,?\s*", "", address)  # strip pin codes
    cleaned = re.sub(r",?\s*(India|Pakistan|Bangladesh|Sri Lanka)\s*$", "", cleaned, flags=re.IGNORECASE)
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    # City is usually the part just before the state (second-to-last)
    if len(parts) >= 2:
        return parts[-2]
    return parts[-1] if parts else address

# SOLARBULL-IMPROVEMENT: Task 4 — normalise CO₂ to tonnes everywhere
def _normalise_co2_tonnes(val):
    """Convert CO₂ value to tonnes. Values > 1000 are assumed to be in kg."""
    if val is None:
        return None
    val = float(val)
    return round(val / 1000, 3) if val > 1000 else round(val, 3)

def _parse_plant_status(status):
    s = str(status).lower().strip()
    try:
        code = int(s)
        if code == 1: return "online"
        if code == 0: return "offline"
        return "warning"
    except ValueError:
        pass
    if s in ("online", "normal", "running"):
        return "online"
    if s in ("fault", "offline", "disconnected"):
        return "offline"
    return "warning"

def _parse_device_status(status):
    m = {0: "offline", 1: "online", 2: "standby", 3: "fault", 4: "warning", 5: "maintenance"}
    try:
        return m.get(int(status), "unknown")
    except (ValueError, TypeError):
        return str(status)

# ---------------------------------------------------------------------------
# Computed KPIs
# ---------------------------------------------------------------------------
def compute_plant_stats(plant: dict, tariff: float = None) -> dict:
    """Attach derived KPIs to a plant dict in-place. Returns the dict.
    tariff: per-kWh rate in INR; if None, falls back to plant['tariffPerKwh'] then global TARIFF_PER_KWH.
    """
    cap     = plant.get("capacity") or 0
    today_e = plant.get("todayEnergy") or 0
    total_e = plant.get("totalEnergy") or 0

    # Per-plant tariff precedence: caller arg > plant field > global default
    effective_tariff = tariff or plant.get("tariffPerKwh") or TARIFF_PER_KWH

    specific_yield   = round(today_e / cap, 3)            if cap > 0 else None
    perf_ratio       = round(specific_yield / PEAK_SUN_HOURS, 3) if specific_yield is not None else None
    capacity_factor  = round((today_e / (cap * 24)) * 100, 2)   if cap > 0 else None
    co2_avoided_raw  = plant.get("co2") or round(total_e * CO2_KG_PER_KWH, 1)
    co2_avoided      = _normalise_co2_tonnes(co2_avoided_raw)
    revenue_today    = round(today_e * effective_tariff, 2)

    if perf_ratio is None:
        grade = "N/A"
    elif perf_ratio >= PR_EXCELLENT:
        grade = "Excellent"
    elif perf_ratio >= PR_GOOD:
        grade = "Good"
    elif perf_ratio >= PR_FAIR:
        grade = "Fair"
    else:
        grade = "Poor"

    plant.update({
        "specificYield":    specific_yield,
        "performanceRatio": perf_ratio,
        "capacityFactor":   capacity_factor,
        "co2Avoided":       co2_avoided,        # tonnes
        "co2AvoidedTonnes": co2_avoided,        # alias — guaranteed tonnes
        "revenueToday":     revenue_today,
        "grade":            grade,
        "peakSunHours":     PEAK_SUN_HOURS,
        "tariffPerKwh":     effective_tariff,
    })
    return plant

# ---------------------------------------------------------------------------
# Error code reference
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Sungrow inverter real-time point code → field name mapping
# Based on Sungrow OpenAPI v2 (iSolarCloud) data point specifications
# ---------------------------------------------------------------------------
SUNGROW_INVERTER_POINTS = {
    # AC Output
    "p83001": ("activePower",    "kW"),
    "p83002": ("reactivePower",  "kVAR"),
    "p83003": ("apparentPower",  "kVA"),
    "p83004": ("powerFactor",    ""),
    "p83005": ("frequency",      "Hz"),
    "p83006": ("voltageA",       "V"),
    "p83007": ("voltageB",       "V"),
    "p83008": ("voltageC",       "V"),
    "p83009": ("voltageAB",      "V"),
    "p83010": ("voltageBC",      "V"),
    "p83011": ("voltageCA",      "V"),
    "p83012": ("currentA",       "A"),
    "p83013": ("currentB",       "A"),
    "p83014": ("currentC",       "A"),
    # DC Bus
    "p83015": ("totalDCPower",   "kW"),
    "p83016": ("busDCVoltage",   "V"),
    # MPPT inputs (p83017/18 = MPPT1, p83019/20 = MPPT2 … up to MPPT8)
    "p83017": ("mppt1Voltage",   "V"),
    "p83018": ("mppt1Current",   "A"),
    "p83019": ("mppt2Voltage",   "V"),
    "p83020": ("mppt2Current",   "A"),
    "p83021": ("mppt3Voltage",   "V"),
    "p83022": ("mppt3Current",   "A"),
    "p83023": ("mppt4Voltage",   "V"),
    "p83024": ("mppt4Current",   "A"),
    "p83025": ("mppt5Voltage",   "V"),
    "p83026": ("mppt5Current",   "A"),
    "p83027": ("mppt6Voltage",   "V"),
    "p83028": ("mppt6Current",   "A"),
    # Energy
    "p83029": ("todayEnergy",    "kWh"),
    "p83030": ("totalEnergy",    "kWh"),
    # Thermal
    "p83031": ("tempInternal",   "°C"),
    "p83032": ("tempHeatsink",   "°C"),
    "p83057": ("tempModule",     "°C"),
    "p83058": ("tempAmbient",    "°C"),
    # Weather sensor
    "p83059": ("irradiance",     "W/m²"),
    # Running state
    "p83079": ("runningStatus",  ""),
    "p83080": ("errorCode",      ""),
    # String currents (p83033-p83048 → strings 1-16)
    "p83033": ("str1Current",    "A"),
    "p83034": ("str2Current",    "A"),
    "p83035": ("str3Current",    "A"),
    "p83036": ("str4Current",    "A"),
    "p83037": ("str5Current",    "A"),
    "p83038": ("str6Current",    "A"),
    "p83039": ("str7Current",    "A"),
    "p83040": ("str8Current",    "A"),
    "p83041": ("str9Current",    "A"),
    "p83042": ("str10Current",   "A"),
    "p83043": ("str11Current",   "A"),
    "p83044": ("str12Current",   "A"),
    "p83045": ("str13Current",   "A"),
    "p83046": ("str14Current",   "A"),
    "p83047": ("str15Current",   "A"),
    "p83048": ("str16Current",   "A"),
    # String voltages (some models)
    "p83049": ("str1Voltage",    "V"),
    "p83050": ("str2Voltage",    "V"),
    "p83051": ("str3Voltage",    "V"),
    "p83052": ("str4Voltage",    "V"),
    "p83053": ("str5Voltage",    "V"),
    "p83054": ("str6Voltage",    "V"),
    "p83055": ("str7Voltage",    "V"),
    "p83056": ("str8Voltage",    "V"),
}

# Legacy / alternative field names some Sungrow API versions return
_LEGACY_FIELD_MAP = {
    "p_ac": "activePower",  "pac": "activePower",   "p_grid": "activePower",
    "q_ac": "reactivePower",
    "cos_phi": "powerFactor", "pf": "powerFactor",
    "f_ac": "frequency",    "fac": "frequency",
    "u_a": "voltageA",  "vac_a": "voltageA",
    "u_b": "voltageB",  "vac_b": "voltageB",
    "u_c": "voltageC",  "vac_c": "voltageC",
    "u_ab": "voltageAB", "u_bc": "voltageBC", "u_ca": "voltageCA",
    "i_a": "currentA",  "iac_a": "currentA",
    "i_b": "currentB",  "iac_b": "currentB",
    "i_c": "currentC",  "iac_c": "currentC",
    "p_dc": "totalDCPower", "pdc": "totalDCPower",
    "u_dc": "busDCVoltage", "vdc_bus": "busDCVoltage",
    "mppt_1_u": "mppt1Voltage", "vpv1": "mppt1Voltage",
    "mppt_1_i": "mppt1Current", "ipv1": "mppt1Current",
    "mppt_2_u": "mppt2Voltage", "vpv2": "mppt2Voltage",
    "mppt_2_i": "mppt2Current", "ipv2": "mppt2Current",
    "mppt_3_u": "mppt3Voltage", "vpv3": "mppt3Voltage",
    "mppt_3_i": "mppt3Current", "ipv3": "mppt3Current",
    "mppt_4_u": "mppt4Voltage", "vpv4": "mppt4Voltage",
    "mppt_4_i": "mppt4Current", "ipv4": "mppt4Current",
    "e_day": "todayEnergy",   "e_today": "todayEnergy",
    "e_total": "totalEnergy", "e_lifetime": "totalEnergy",
    "temp_inside": "tempInternal", "temperature": "tempInternal",
    "temp_heatsink": "tempHeatsink",
    "efficiency": "efficiency",
}

SUNGROW_ERROR_CODES = {
    "002": {"desc": "Grid overvoltage",              "severity": "high",   "fix": "Check grid voltage. Adjust VAC upper limit if within tolerance."},
    "003": {"desc": "Grid undervoltage",             "severity": "high",   "fix": "Check grid connection. Verify transformer settings."},
    "004": {"desc": "Grid overfrequency",            "severity": "medium", "fix": "Wait for grid frequency to normalize. Contact DISCOM if persistent."},
    "005": {"desc": "Grid underfrequency",           "severity": "medium", "fix": "Check local grid stability. Usually transient."},
    "006": {"desc": "Grid loss / Islanding",         "severity": "high",   "fix": "Check grid connection. Inspect main breaker and meter."},
    "010": {"desc": "PV overvoltage",                "severity": "high",   "fix": "Reduce panels per string. Check string voltage vs max Vdc."},
    "011": {"desc": "Bus overvoltage",               "severity": "high",   "fix": "Power cycle inverter. Contact service if persistent."},
    "012": {"desc": "Hardware fault",                "severity": "high",   "fix": "Power cycle inverter. Service center required."},
    "013": {"desc": "Internal communication error",  "severity": "medium", "fix": "Power cycle inverter. Check internal connections."},
    "014": {"desc": "DCI high (DC injection)",       "severity": "high",   "fix": "Internal fault. Service center repair required."},
    "015": {"desc": "Insulation resistance low",     "severity": "high",   "fix": "Check PV cable insulation. Test strings with megger."},
    "016": {"desc": "Ground fault",                  "severity": "high",   "fix": "Check all ground connections. Inspect wiring for damage."},
    "017": {"desc": "Leakage current high",          "severity": "high",   "fix": "Check for moisture in connections. Inspect junction boxes."},
    "020": {"desc": "Over-temperature",              "severity": "medium", "fix": "Improve ventilation. Clean dust filters. Check fans."},
    "021": {"desc": "Fan fault",                     "severity": "low",    "fix": "Clean or replace cooling fan."},
    "022": {"desc": "MPPT fault",                    "severity": "medium", "fix": "Check panel connections. Inspect for shading or damage."},
    "023": {"desc": "String current unbalance",      "severity": "low",    "fix": "Check string configurations. Clean panels."},
    "024": {"desc": "Arc fault detected (AFCI)",     "severity": "high",   "fix": "Inspect DC wiring for loose connections."},
    "025": {"desc": "Reverse polarity on PV",        "severity": "high",   "fix": "Check DC polarity on string input. Correct wiring."},
    "026": {"desc": "Communication lost",            "severity": "medium", "fix": "Check WiNet/EyeM4 dongle. Verify internet connection."},
    "027": {"desc": "Battery fault",                 "severity": "high",   "fix": "Check battery connection. Inspect BMS status."},
    "028": {"desc": "Firmware update available",     "severity": "low",    "fix": "Update via iSolarCloud app or portal."},
    "029": {"desc": "Relay fault",                   "severity": "high",   "fix": "Internal relay failure. Service center required."},
    "030": {"desc": "Residual current detection fault","severity": "high", "fix": "Check GFCI. Inspect all ground connections."},
}

def lookup_error(code):
    code_str = str(code).zfill(3).upper().strip()
    if code_str in SUNGROW_ERROR_CODES:
        return {**SUNGROW_ERROR_CODES[code_str], "code": code_str}
    code_int = str(int(code_str)) if code_str.isdigit() else code_str
    for key, val in SUNGROW_ERROR_CODES.items():
        if key.lstrip("0") == code_int:
            return {**val, "code": key}
    return {"code": code_str, "desc": f"Error code {code_str}", "severity": "medium",
            "fix": "Check iSolarCloud app for details or contact Sungrow service."}


def _parse_device_points(rt_data, sn=None):
    """Parse getDeviceRealTimeData response → ({fieldName: floatValue}, {rawCode: rawValue}).

    Handles three Sungrow API formats:
      1. device_point_list[].data_point_detail[] with data_point_code/value
      2. Flat dict with p83xxx keys
      3. Legacy named-field dict (p_ac, u_ab, etc.)
    """
    if not rt_data or not isinstance(rt_data, dict):
        return {}, {}

    # Find the device sub-dict
    device_data = None
    for list_key in ("device_point_list", "device_data_list", "devices", "list", "inverters"):
        device_list = rt_data.get(list_key)
        if not isinstance(device_list, list):
            continue
        for dev in device_list:
            if not isinstance(dev, dict):
                continue
            if sn and dev.get("device_sn") != sn:
                continue
            device_data = dev
            break
        if device_data:
            break

    if device_data is None:
        device_data = rt_data  # single-device or flat format

    raw_codes = {}
    parsed    = {}

    # Format 1: list of {data_point_code, value} entries
    for dp_key in ("data_point_detail", "data_list", "data_points", "point_list", "points"):
        dp_list = device_data.get(dp_key)
        if not isinstance(dp_list, list):
            continue
        for pt in dp_list:
            if not isinstance(pt, dict):
                continue
            code = (pt.get("data_point_code") or pt.get("code") or pt.get("key") or "")
            val  = pt.get("value") or pt.get("val") or ""
            if code:
                raw_codes[code] = val
                if code in SUNGROW_INVERTER_POINTS:
                    field, _ = SUNGROW_INVERTER_POINTS[code]
                    parsed[field] = _safe_float(val)
        if raw_codes:
            break  # found data — stop searching

    # Format 2: flat dict with p8xxxx keys
    if not raw_codes:
        for k, v in device_data.items():
            if isinstance(k, str) and k.startswith("p8") and not isinstance(v, (dict, list)):
                raw_codes[k] = v
                if k in SUNGROW_INVERTER_POINTS:
                    field, _ = SUNGROW_INVERTER_POINTS[k]
                    parsed[field] = _safe_float(v)

    # Format 3: legacy named fields (fallback for older API versions)
    if not parsed:
        for legacy_key, field_name in _LEGACY_FIELD_MAP.items():
            val = device_data.get(legacy_key)
            if val is not None and val not in ("", "--"):
                parsed[field_name] = _safe_float(val)

    return parsed, raw_codes

# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------
def generate_demo_data():
    import random
    cities = ["Hyderabad","Vijayawada","Visakhapatnam","Warangal","Guntur",
              "Tirupati","Rajahmundry","Karimnagar","Nellore","Khammam",
              "Nizamabad","Kurnool","Anantapur","Kadapa","Mahbubnagar",
              "Siddipet","Suryapet","Mancherial","Adilabad","Bhimavaram",
              "Eluru","Ongole","Srikakulam","Tenali","Nalgonda",
              "Medak","Sangareddy","Jagtial","Peddapalli","Kamareddy",
              "Wanaparthy","Miryalaguda"]
    models = ["SG5.0RS","SG8.0RT","SG10RT-V112","SG33CX","SG50CX","SG125HV"]
    error_pool = list(SUNGROW_ERROR_CODES.keys())

    plants = []
    for i in range(32):
        cap = round(20 + random.random() * 480, 1)
        eff = round(75 + random.random() * 22, 1)
        status = "online" if random.random() > 0.12 else (
            "warning" if random.random() > 0.4 else "offline")
        errors = []
        if status != "online":
            for _ in range(random.randint(1, 3)):
                code = random.choice(error_pool)
                err = lookup_error(code)
                err["timestamp"] = (datetime.now() - timedelta(hours=random.randint(1, 168))).isoformat()
                errors.append(err)
        today_gen   = 0 if status == "offline" else round(cap * eff / 100 * (4 + random.random() * 3), 1)
        month_gen   = round(today_gen * (22 + random.random() * 6), 1)
        total_gen   = round(month_gen * (6 + random.random() * 30), 1)
        curr_power  = None if status == "offline" else round(cap * eff / 100 * (0.3 + random.random() * 0.6), 1)
        history = []
        for d in range(7):
            date = datetime.now() - timedelta(days=6 - d)
            gen  = round(cap * eff / 100 * (3 + random.random() * 4), 1)
            if status == "offline" and d >= 5:
                gen = 0
            history.append({"date": date.strftime("%Y-%m-%d"), "energy": gen})
        p = {
            "id": str(1000 + i),
            "name": f"SB-{str(i + 1).zfill(3)} {cities[i % len(cities)]}",
            "city": cities[i % len(cities)],
            "status": status,
            "capacity": cap,
            "todayEnergy": today_gen,
            "monthEnergy": month_gen,
            "totalEnergy": total_gen,
            "currentPower": curr_power,
            "co2": round(total_gen * 0.82, 1),
            "installDate": (datetime.now() - timedelta(days=random.randint(180, 1800))).strftime("%Y-%m-%d"),
            "latitude":  17.4 + random.random() * 1.5,
            "longitude": 78.4 + random.random() * 2.0,
            "devices": [{
                "deviceSn":   f"B{1000 + i}{random.randint(100000, 999999)}",
                "datalogSn":  f"D{2000 + i}{random.randint(100000, 999999)}",
                "deviceType": "Inverter",
                "model":      models[i % len(models)],
                "status":     status,
                "lastUpdate": datetime.now().isoformat(),
            }],
            "errors": errors,
            "history": history,
        }
        compute_plant_stats(p)
        plants.append(p)
    return plants


client = SungrowClient()


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    user = dict(user)
    if not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return jsonify({"error": "Invalid credentials"}), 401
    token = make_token(user["id"], user["role"])
    return jsonify({
        "token": token,
        "user": {
            "id":        user["id"],
            "username":  user["username"],
            "name":      user["name"],
            "email":     user["email"],
            "role":      user["role"],
            "plant_ids": json.loads(user["plant_ids"] or "[]"),
        },
    })

@app.route("/api/auth/me")
@require_role()
def auth_me(current_user):
    return jsonify({
        "id":        current_user["id"],
        "username":  current_user["username"],
        "name":      current_user["name"],
        "email":     current_user["email"],
        "role":      current_user["role"],
        "plant_ids": json.loads(current_user["plant_ids"] or "[]"),
    })

# SOLARBULL-IMPROVEMENT: Task 3 — JWT refresh endpoint
@app.route("/api/auth/refresh", methods=["POST"])
@require_role()
def auth_refresh(current_user):
    """Return a fresh token for an authenticated user."""
    token = make_token(current_user["id"], current_user["role"])
    return jsonify({"token": token})

# SOLARBULL-IMPROVEMENT: Task 5 — health check endpoint
@app.route("/api/health")
def health():
    return jsonify({
        "status":        "ok",
        "demo":          USE_DEMO,
        "lastPollTime":  _last_poll_time,
        "lastPollCount": _last_poll_count,
        "cacheKeys":     len(client._cache),
        "serverTime":    datetime.utcnow().isoformat() + "Z",
    })

# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------
@app.route("/api/admin/users", methods=["GET"])
@require_role("admin")
def admin_list_users(current_user):
    conn  = get_db()
    users = conn.execute("SELECT id,username,name,email,role,plant_ids,created_at FROM users ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])

@app.route("/api/admin/users", methods=["POST"])
@require_role("admin")
def admin_create_user(current_user):
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    name     = (data.get("name") or "").strip()
    email    = (data.get("email") or "").strip()
    role     = data.get("role", "client")
    plant_ids = json.dumps(data.get("plant_ids", []))

    if not username or not password or not name:
        return jsonify({"error": "username, password, and name are required"}), 400
    if role not in ("admin", "client"):
        return jsonify({"error": "role must be admin or client"}), 400

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO users (username,password_hash,name,email,role,plant_ids,created_at) VALUES (?,?,?,?,?,?,?)",
            (username, pw_hash, name, email, role, plant_ids, datetime.now().isoformat())
        )
        conn.commit()
        uid = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()["id"]
        conn.close()
    except sqlite3.IntegrityError:
        return jsonify({"error": f"Username '{username}' already exists"}), 409
    return jsonify({"id": uid, "username": username, "name": name, "email": email,
                    "role": role, "plant_ids": data.get("plant_ids", [])}), 201

@app.route("/api/admin/users/<int:uid>", methods=["PUT"])
@require_role("admin")
def admin_update_user(uid, current_user):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "User not found"}), 404
    user = dict(user)

    name      = data.get("name",      user["name"])
    email     = data.get("email",     user["email"])
    role      = data.get("role",      user["role"])
    plant_ids = json.dumps(data.get("plant_ids", json.loads(user["plant_ids"] or "[]")))
    # Admin always gets full access
    if role == "admin":
        plant_ids = "[]"

    updates = [("name", name), ("email", email), ("role", role), ("plant_ids", plant_ids)]
    if "password" in data and data["password"]:
        pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
        updates.append(("password_hash", pw_hash))

    for col, val in updates:
        conn.execute(f"UPDATE users SET {col}=? WHERE id=?", (val, uid))
    conn.commit()
    conn.close()
    return jsonify({"id": uid, "username": user["username"], "name": name,
                    "email": email, "role": role, "plant_ids": json.loads(plant_ids)})

@app.route("/api/admin/users/<int:uid>", methods=["DELETE"])
@require_role("admin")
def admin_delete_user(uid, current_user):
    if uid == current_user["id"]:
        return jsonify({"error": "Cannot delete your own account"}), 400
    conn = get_db()
    result = conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"message": "User deleted"})

# ---------------------------------------------------------------------------
# Plant routes
# ---------------------------------------------------------------------------
def _filter_plants_for_user(plants, current_user):
    if current_user["role"] == "admin":
        return plants
    allowed = set(json.loads(current_user["plant_ids"] or "[]"))
    return [p for p in plants if p["id"] in allowed]

@app.route("/api/plants")
@require_role()
def api_plants(current_user):
    try:
        plants = generate_demo_data() if (USE_DEMO or not SUNGROW_APPKEY) else client.get_all_plants_summary()
        plants = _filter_plants_for_user(plants, current_user)
        return jsonify({"plants": plants, "count": len(plants)})
    except Exception as e:
        log.error("Failed to get plants: %s\n%s", e, traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route("/api/plants/<plant_id>")
@require_role()
def api_plant_detail(plant_id, current_user):
    try:
        # Access check for client role
        if current_user["role"] != "admin":
            allowed = set(json.loads(current_user["plant_ids"] or "[]"))
            if plant_id not in allowed:
                return jsonify({"error": "Access denied"}), 403

        if USE_DEMO or not SUNGROW_APPKEY:
            plants = generate_demo_data()
            plant  = next((p for p in plants if p["id"] == plant_id), None)
            if not plant:
                return jsonify({"error": "Plant not found"}), 404
            return jsonify(plant)

        result = client.get_plant_detail_full(plant_id)
        return jsonify(result)
    except Exception as e:
        log.error("Failed to get plant %s: %s", plant_id, e)
        return jsonify({"error": str(e)}), 500

# ---------------------------------------------------------------------------
# Time-series endpoint
# ---------------------------------------------------------------------------
# SOLARBULL-IMPROVEMENT: Task 11 — history endpoint with configurable days
@app.route("/api/plants/<plant_id>/history")
@require_role()
def api_plant_history(plant_id, current_user):
    """GET /api/plants/<id>/history?days=7|30|90"""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    days = min(int(request.args.get("days", 7)), 90)

    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            import random
            data = []
            for i in range(days):
                d = datetime.now() - timedelta(days=days - 1 - i)
                data.append({
                    "date":   d.strftime("%Y-%m-%d"),
                    "energy": round(200 + random.random() * 400, 1),
                })
            return jsonify({"days": days, "data": data})

        history = client.get_plant_generation_history(plant_id, days)
        return jsonify({"days": days, "data": history})
    except Exception as e:
        log.error("History failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e), "data": []}), 500

@app.route("/api/plants/<plant_id>/timeseries")
@require_role()
def api_timeseries(plant_id, current_user):
    """
    Query params:
      range: 1d | 1w | 1m | 3m | 1y  (default 1d)
      metric: energy | power           (default energy)
    Returns: { plant_id, range, metric, data: [{ts, value, unit}], unit }
    """
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    range_param  = request.args.get("range", "1d")
    metric_param = request.args.get("metric", "energy")
    points_code  = "p83022"  # generation energy / power

    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            data = _generate_demo_timeseries(range_param)
            unit = "kWh" if metric_param == "energy" else "kW"
            return jsonify({"plant_id": plant_id, "range": range_param,
                            "metric": metric_param, "data": data, "unit": unit})

        data = []
        now  = datetime.now()

        if range_param == "1d":
            date_str = now.strftime("%Y%m%d")
            raw = client.get_chart_data(plant_id, date_str, "1", points_code)
            data = _parse_chart_points(raw, now.strftime("%Y-%m-%d"), interval_min=15)

        elif range_param == "1w":
            for i in range(7):
                d        = now - timedelta(days=6 - i)
                date_str = d.strftime("%Y%m%d")
                raw      = client.get_chart_data(plant_id, date_str, "1", points_code)
                total    = sum(p["value"] for p in _parse_chart_points(raw, d.strftime("%Y-%m-%d"), 15))
                data.append({"ts": d.strftime("%Y-%m-%d"), "value": round(total, 1)})

        elif range_param == "1m":
            date_str = now.strftime("%Y%m")
            raw  = client.get_chart_data(plant_id, date_str, "2", points_code)
            data = _parse_chart_points_monthly(raw, now.year, now.month)

        elif range_param == "3m":
            for i in range(3):
                d    = now - timedelta(days=30 * (2 - i))
                ds   = d.strftime("%Y%m")
                raw  = client.get_chart_data(plant_id, ds, "2", points_code)
                pts  = _parse_chart_points_monthly(raw, d.year, d.month)
                data.extend(pts)

        elif range_param == "1y":
            date_str = now.strftime("%Y")
            raw  = client.get_chart_data(plant_id, date_str, "3", points_code)
            data = _parse_chart_points_yearly(raw, now.year)

        else:
            return jsonify({"error": f"Unknown range: {range_param}"}), 400

        unit = "kWh" if metric_param == "energy" else "kW"
        return jsonify({"plant_id": plant_id, "range": range_param,
                        "metric": metric_param, "data": data, "unit": unit})

    except Exception as e:
        log.error("Timeseries failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e), "data": []}), 500


def _parse_chart_points(raw, date_prefix, interval_min=15):
    """Parse Sungrow getPowerChartData result into [{ts, value}] list."""
    if not raw or not isinstance(raw, dict):
        return []
    points = raw.get("data_points", raw.get("points", []))
    if not points:
        return []
    result = []
    for idx, p in enumerate(points):
        raw_ts = p.get("data_time") or p.get("time") or p.get("ts")
        if raw_ts:
            ts = str(raw_ts)
        else:
            mins = idx * interval_min
            h, m = divmod(mins, 60)
            ts = f"{date_prefix}T{h:02d}:{m:02d}:00"
        val = p.get("value")
        if val is not None and val != "--":
            try:
                result.append({"ts": ts, "value": round(float(val), 2)})
            except (ValueError, TypeError):
                pass
    return result

def _parse_chart_points_monthly(raw, year, month):
    if not raw or not isinstance(raw, dict):
        return []
    points = raw.get("data_points", raw.get("points", []))
    result = []
    for idx, p in enumerate(points):
        day = idx + 1
        ts  = f"{year}-{month:02d}-{day:02d}"
        val = p.get("value")
        if val is not None and val != "--":
            try:
                result.append({"ts": ts, "value": round(float(val), 2)})
            except (ValueError, TypeError):
                pass
    return result

def _parse_chart_points_yearly(raw, year):
    if not raw or not isinstance(raw, dict):
        return []
    points = raw.get("data_points", raw.get("points", []))
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    result = []
    for idx, p in enumerate(points):
        ts  = months[idx] if idx < 12 else f"M{idx+1}"
        val = p.get("value")
        if val is not None and val != "--":
            try:
                result.append({"ts": ts, "value": round(float(val), 2)})
            except (ValueError, TypeError):
                pass
    return result

def _generate_demo_timeseries(range_param):
    import random, math
    now = datetime.now()
    data = []
    if range_param == "1d":
        for h in range(6, 19):
            for m in (0, 15, 30, 45):
                frac = (h - 6 + m / 60) / 13
                val  = round(max(0, 120 * math.sin(math.pi * frac) + random.uniform(-5, 5)), 1)
                data.append({"ts": f"{now.strftime('%Y-%m-%d')}T{h:02d}:{m:02d}:00", "value": val})
    elif range_param == "1w":
        for i in range(7):
            d   = now - timedelta(days=6 - i)
            val = round(500 + random.uniform(-100, 100), 1)
            data.append({"ts": d.strftime("%Y-%m-%d"), "value": val})
    elif range_param in ("1m", "3m"):
        days = 30 if range_param == "1m" else 90
        for i in range(days):
            d   = now - timedelta(days=days - 1 - i)
            val = round(500 + random.uniform(-150, 150), 1)
            data.append({"ts": d.strftime("%Y-%m-%d"), "value": val})
    elif range_param == "1y":
        months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        for m in months:
            data.append({"ts": m, "value": round(14000 + random.uniform(-3000, 3000), 1)})
    return data

# ---------------------------------------------------------------------------
# Misc routes
# ---------------------------------------------------------------------------
@app.route("/api/errors")
@require_role()
def api_errors(current_user):
    return jsonify({"codes": SUNGROW_ERROR_CODES, "count": len(SUNGROW_ERROR_CODES)})

@app.route("/api/errors/<code>")
@require_role()
def api_error_lookup(code, current_user):
    return jsonify(lookup_error(code))

@app.route("/api/cache/clear", methods=["POST"])
@require_role("admin")
def api_clear_cache(current_user):
    client.clear_cache()
    return jsonify({"message": "Cache cleared"})

# ---------------------------------------------------------------------------
# Settings routes
# ---------------------------------------------------------------------------
def _get_all_settings(conn):
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    s = {r["key"]: r["value"] for r in rows}
    return {
        "tariffPerKwh":  float(s.get("tariff_per_kwh", TARIFF_PER_KWH)),
        "peakSunHours":  float(s.get("peak_sun_hours", PEAK_SUN_HOURS)),
        "co2Factor":     float(s.get("co2_factor", CO2_KG_PER_KWH)),
        "prExcellent":   float(s.get("pr_excellent", PR_EXCELLENT)),
        "prGood":        float(s.get("pr_good", PR_GOOD)),
        "prFair":        float(s.get("pr_fair", PR_FAIR)),
        "currency":      s.get("currency", "INR"),
        "timezone":      s.get("timezone", "Asia/Kolkata"),
        "companyName":   s.get("company_name", "SolarBull Energy"),
    }

@app.route("/api/settings")
@require_role()
def get_settings(current_user):
    conn = get_db()
    s = _get_all_settings(conn)
    conn.close()
    return jsonify(s)

@app.route("/api/settings", methods=["PUT"])
@require_role("admin")
def update_settings(current_user):
    data = request.get_json(silent=True) or {}
    mapping = {
        "tariffPerKwh": "tariff_per_kwh",
        "peakSunHours": "peak_sun_hours",
        "co2Factor":    "co2_factor",
        "prExcellent":  "pr_excellent",
        "prGood":       "pr_good",
        "prFair":       "pr_fair",
        "currency":     "currency",
        "timezone":     "timezone",
        "companyName":  "company_name",
    }
    conn = get_db()
    for js_key, db_key in mapping.items():
        if js_key in data:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                        (db_key, str(data[js_key])))
    conn.commit()
    s = _get_all_settings(conn)
    conn.close()
    # Update runtime constants
    global TARIFF_PER_KWH, PEAK_SUN_HOURS, CO2_KG_PER_KWH, PR_EXCELLENT, PR_GOOD, PR_FAIR
    TARIFF_PER_KWH = s["tariffPerKwh"]
    PEAK_SUN_HOURS = s["peakSunHours"]
    CO2_KG_PER_KWH = s["co2Factor"]
    PR_EXCELLENT   = s["prExcellent"]
    PR_GOOD        = s["prGood"]
    PR_FAIR        = s["prFair"]
    return jsonify(s)

# ---------------------------------------------------------------------------
# Fleet analytics route
# ---------------------------------------------------------------------------
@app.route("/api/fleet/analytics")
@require_role()
def fleet_analytics(current_user):
    """
    Returns fleet-wide aggregated analytics.
    Reads today's plant snapshot + generates historical simulation.
    """
    import random, math
    range_param = request.args.get("range", "30d")
    range_days  = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}.get(range_param, 30)

    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            plants = generate_demo_data()
        else:
            # Use cached plants (no extra Sungrow call)
            plants = client._cached("all_plants_summary", client._fetch_all_plants_summary, ttl=300)
        plants = _filter_plants_for_user(plants, current_user)

        # Current totals
        total_cap    = sum(p.get("capacity") or 0 for p in plants)
        total_energy_today = sum(p.get("todayEnergy") or 0 for p in plants)
        total_co2    = sum(p.get("co2Avoided") or p.get("co2") or 0 for p in plants)
        total_rev    = sum(p.get("revenueToday") or 0 for p in plants)
        online       = sum(1 for p in plants if p.get("status") == "online")
        warning      = sum(1 for p in plants if p.get("status") == "warning")
        offline      = sum(1 for p in plants if p.get("status") == "offline")
        active       = [p for p in plants if p.get("performanceRatio")]
        avg_pr       = sum(p["performanceRatio"] for p in active) / len(active) if active else None
        total_alerts = sum(len(p.get("errors") or []) for p in plants)

        # Simulated historical timeline (blend today's snapshot with noise for visualization)
        # In production this would come from the snapshots table
        timeline = []
        today    = datetime.now()
        base_energy = total_energy_today or total_cap * 0.6
        base_pr     = avg_pr or 0.76
        for i in range(range_days):
            d    = today - timedelta(days=range_days - 1 - i)
            frac = i / max(range_days - 1, 1)
            # Gentle upward trend + weekend dip + noise
            weekend_factor = 0.97 if d.weekday() >= 5 else 1.0
            season_factor  = 0.85 + 0.15 * math.sin(math.pi * (d.timetuple().tm_yday / 365))
            noise          = 1.0 + random.uniform(-0.06, 0.06)
            energy = round(base_energy * weekend_factor * season_factor * noise, 1)
            pr     = round(min(0.95, max(0.40, base_pr * season_factor * noise)), 3)
            on     = max(0, online + random.randint(-2, 1))
            timeline.append({
                "date":          d.strftime("%Y-%m-%d"),
                "totalEnergy":   energy,
                "avgPR":         pr,
                "online":        min(on, len(plants)),
                "revenue":       round(energy * TARIFF_PER_KWH, 0),
                "co2Avoided":    round(energy * CO2_KG_PER_KWH, 0),
            })

        # Grade distribution
        grade_dist = {}
        for p in plants:
            g = p.get("grade") or "N/A"
            grade_dist[g] = grade_dist.get(g, 0) + 1

        # Top / bottom performers
        ranked = sorted([p for p in plants if p.get("performanceRatio")],
                        key=lambda p: p["performanceRatio"], reverse=True)
        top5    = [{"id": p["id"], "name": p["name"], "pr": p["performanceRatio"], "grade": p["grade"]} for p in ranked[:5]]
        bottom5 = [{"id": p["id"], "name": p["name"], "pr": p["performanceRatio"], "grade": p["grade"]} for p in ranked[-5:]]

        # PR histogram buckets
        pr_hist = {"0–55%": 0, "55–70%": 0, "70–80%": 0, "80–90%": 0, "90%+": 0}
        for p in plants:
            pr = p.get("performanceRatio")
            if pr is None:
                continue
            pct = pr * 100
            if pct < 55:
                pr_hist["0–55%"] += 1
            elif pct < 70:
                pr_hist["55–70%"] += 1
            elif pct < 80:
                pr_hist["70–80%"] += 1
            elif pct < 90:
                pr_hist["80–90%"] += 1
            else:
                pr_hist["90%+"] += 1

        return jsonify({
            "range":      range_param,
            "summary": {
                "totalPlants":     len(plants),
                "totalCapacity":   round(total_cap, 1),
                "todayEnergy":     round(total_energy_today, 1),
                "totalCO2":        round(total_co2, 1),
                "todayRevenue":    round(total_rev, 2),
                "avgPR":           round(avg_pr, 3) if avg_pr else None,
                "online":          online,
                "warning":         warning,
                "offline":         offline,
                "totalAlerts":     total_alerts,
                "estimatedMonthly": round(total_energy_today * 26 * TARIFF_PER_KWH, 0),
            },
            "timeline":    timeline,
            "gradeDist":   [{"grade": k, "count": v} for k, v in grade_dist.items()],
            "prHistogram": [{"bucket": k, "count": v} for k, v in pr_hist.items()],
            "top5":        top5,
            "bottom5":     bottom5,
        })
    except Exception as e:
        log.error("Fleet analytics failed: %s", e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Notifications (all alarms across fleet)
# ---------------------------------------------------------------------------
@app.route("/api/notifications")
@require_role()
def all_notifications(current_user):
    """All alarms across user's plants, sorted by severity then time."""
    sev_order = {"high": 0, "medium": 1, "low": 2}
    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            plants = generate_demo_data()
        else:
            plants = client._cached("all_plants_summary", client._fetch_all_plants_summary, ttl=300)
        plants = _filter_plants_for_user(plants, current_user)
        all_errors = []
        for p in plants:
            for e in (p.get("errors") or []):
                all_errors.append({
                    **e,
                    "plantId":   p["id"],
                    "plantName": p["name"],
                    "plantStatus": p.get("status"),
                })
        all_errors.sort(key=lambda x: (sev_order.get(x.get("severity"), 1), x.get("timestamp", "")))
        counts = {
            "total":  len(all_errors),
            "high":   sum(1 for e in all_errors if e.get("severity") == "high"),
            "medium": sum(1 for e in all_errors if e.get("severity") == "medium"),
            "low":    sum(1 for e in all_errors if e.get("severity") == "low"),
            "plants_affected": len(set(e["plantId"] for e in all_errors)),
        }
        return jsonify({"notifications": all_errors, "counts": counts})
    except Exception as e:
        log.error("Notifications failed: %s", e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Plant comparison
# ---------------------------------------------------------------------------
@app.route("/api/plants/compare")
@require_role()
def compare_plants(current_user):
    """Compare multiple plants. Query param: ids=id1,id2,id3"""
    ids_param = request.args.get("ids", "")
    plant_ids = [x.strip() for x in ids_param.split(",") if x.strip()]
    if not plant_ids:
        return jsonify({"error": "ids query param required"}), 400
    if len(plant_ids) > 6:
        return jsonify({"error": "Max 6 plants for comparison"}), 400
    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            all_plants = generate_demo_data()
        else:
            all_plants = client._cached("all_plants_summary", client._fetch_all_plants_summary, ttl=300)
        all_plants = _filter_plants_for_user(all_plants, current_user)
        selected = [p for p in all_plants if p["id"] in plant_ids]
        return jsonify({"plants": selected})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Inverter / device real-time data
# ---------------------------------------------------------------------------
@app.route("/api/plants/<plant_id>/inverters")
@require_role()
def plant_inverters(plant_id, current_user):
    """Comprehensive real-time inverter data — 3-phase, MPPT, strings, thermal."""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403
    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            import random
            n = random.randint(1, 4)
            return jsonify({"inverters": [_make_demo_inverter(i, plant_id) for i in range(n)]})

        devices = client.get_device_list(plant_id)
        rt      = client.get_device_realtime(plant_id)
        result  = []

        for d in (devices if isinstance(devices, list) else []):
            sn            = d.get("device_sn", "")
            dev_status    = _parse_device_status(d.get("dev_status", 1))
            fault_status  = d.get("dev_fault_status")  # numeric fault code
            parsed, raw_codes = _parse_device_points(rt, sn)

            # Build MPPT array from parsed real-time fields (if available)
            mppts = []
            for i in range(1, 9):
                v = parsed.get(f"mppt{i}Voltage")
                c = parsed.get(f"mppt{i}Current")
                if v is not None or c is not None:
                    mppts.append({
                        "idx":     i,
                        "voltage": v,
                        "current": c,
                        "power":   round(v * c / 1000, 2) if (v and c) else None,
                    })

            # Build string array from parsed real-time fields (if available)
            strings = []
            for i in range(1, 25):
                curr = parsed.get(f"str{i}Current")
                volt = parsed.get(f"str{i}Voltage")
                if curr is not None:
                    mppt_idx = ((i - 1) // 2) + 1
                    strings.append({
                        "idx":     i,
                        "mpptIdx": mppt_idx,
                        "current": curr,
                        "voltage": volt,
                    })

            # Derive fault meaning from dev_fault_status code
            fault_meaning = None
            if fault_status and int(str(fault_status)) not in (0, 3):
                fault_meaning = f"Fault code {fault_status}"

            inv = {
                "sn":                sn,
                "model":             d.get("device_model_code", d.get("device_model", "")),
                "typeName":          "Inverter",
                "status":            dev_status,
                "faultStatus":       fault_status,
                "faultMeaning":      fault_meaning,
                "lastUpdate":        d.get("rel_time", ""),
                "commissioningDate": d.get("grid_connection_date", d.get("install_date", "")),
                "datalogSn":         d.get("communication_dev_sn", ""),
                "channelId":         d.get("chnnl_id"),
                "runningStatus":     parsed.get("runningStatus") or ("Running" if dev_status == "online" else dev_status.capitalize()),
                # AC Output (from real-time API — null if API Level 1 only)
                "activePower":   parsed.get("activePower"),
                "reactivePower": parsed.get("reactivePower"),
                "apparentPower": parsed.get("apparentPower"),
                "powerFactor":   parsed.get("powerFactor"),
                "frequency":     parsed.get("frequency"),
                "voltageA":      parsed.get("voltageA"),
                "voltageB":      parsed.get("voltageB"),
                "voltageC":      parsed.get("voltageC"),
                "voltageAB":     parsed.get("voltageAB"),
                "voltageBC":     parsed.get("voltageBC"),
                "voltageCA":     parsed.get("voltageCA"),
                "currentA":      parsed.get("currentA"),
                "currentB":      parsed.get("currentB"),
                "currentC":      parsed.get("currentC"),
                # DC Bus
                "totalDCPower":  parsed.get("totalDCPower"),
                "busDCVoltage":  parsed.get("busDCVoltage"),
                # MPPT & Strings
                "mppt":          mppts,
                "strings":       strings,
                # Energy
                "todayEnergy":   parsed.get("todayEnergy"),
                "totalEnergy":   parsed.get("totalEnergy"),
                # Thermal
                "tempInternal":  parsed.get("tempInternal"),
                "tempHeatsink":  parsed.get("tempHeatsink"),
                "tempModule":    parsed.get("tempModule"),
                "tempAmbient":   parsed.get("tempAmbient"),
                "irradiance":    parsed.get("irradiance"),
                "efficiency":    parsed.get("efficiency"),
                # Legacy compat
                "power":         parsed.get("activePower"),
                "voltage_ac":    parsed.get("voltageAB") or parsed.get("voltageA"),
                "current_ac":    parsed.get("currentA"),
                "voltage_dc":    parsed.get("mppt1Voltage"),
                "current_dc":    parsed.get("mppt1Current"),
                "temperature":   parsed.get("tempInternal"),
                "rawCount":      len(raw_codes),
                # API capability level: 1 = device list only, 2 = real-time params
                "apiLevel":      2 if raw_codes else 1,
            }
            result.append(inv)

        return jsonify({
            "inverters": result,
            "apiLevel":  2 if any(i["rawCount"] > 0 for i in result) else 1,
            "note":      None if any(i["rawCount"] > 0 for i in result) else
                         "Real-time inverter parameters (voltages, currents, MPPT) require API Level 2 access in iSolarCloud Developer Portal.",
        })
    except Exception as e:
        log.error("Inverter data failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e)}), 500


def _make_demo_inverter(idx, plant_id):
    import random, math
    models       = ["SG33CX", "SG50CX", "SG125HV", "SG10RT-V112", "SG60CX-P", "SG250HX"]
    n_mppt_map   = {"SG33CX": 4, "SG50CX": 4, "SG125HV": 6, "SG10RT-V112": 2, "SG60CX-P": 5, "SG250HX": 12}
    n_str_map    = {"SG33CX": 8, "SG50CX": 10, "SG125HV": 12, "SG10RT-V112": 4, "SG60CX-P": 10, "SG250HX": 24}

    model    = models[idx % len(models)]
    n_mppt   = n_mppt_map[model]
    n_str    = n_str_map[model]
    statuses = ["online", "online", "online", "online", "warning"]
    st       = random.choice(statuses)

    base_pwr   = round(20 + random.random() * 80, 1) if st == "online" else (round(random.random() * 5, 1) if st == "warning" else 0)
    base_v_dc  = round(620 + random.random() * 80, 1)
    base_v_ac  = round(228 + random.random() * 8, 1)
    pf         = round(0.97 + random.random() * 0.028, 3)
    freq       = round(49.95 + random.random() * 0.10, 2)
    phase_a    = round(base_pwr / 3 / base_v_ac * 1000, 1) if base_pwr else 0

    # MPPT array
    mppts = []
    for i in range(1, n_mppt + 1):
        v = round(base_v_dc * (0.97 + random.random() * 0.06), 1) if base_pwr else 0
        c = round(base_pwr / n_mppt / (v / 1000), 1) if (base_pwr and v) else 0
        if i == n_mppt and random.random() < 0.12:  # occasional underperforming MPPT
            v = round(v * 0.91, 1)
            c = round(c * 0.87, 1)
        mppts.append({"idx": i, "voltage": v, "current": c,
                      "power": round(v * c / 1000, 2) if (v and c) else 0})

    # String array (2 strings per MPPT)
    n_spm = max(1, n_str // n_mppt)
    strings = []
    for i in range(1, n_str + 1):
        mi    = min(((i - 1) // n_spm), len(mppts) - 1)
        base_v = mppts[mi]["voltage"] if mppts else base_v_dc
        base_c = mppts[mi]["current"] if mppts else 10
        sc = round(base_c / n_spm * (0.92 + random.random() * 0.16), 1)
        if i % 7 == 0 and random.random() < 0.20:  # partial shade / fault on occasional string
            sc = round(sc * 0.55, 1)
        strings.append({
            "idx": i, "mpptIdx": mi + 1,
            "current": sc if base_pwr else 0,
            "voltage": round(base_v * (0.99 + random.random() * 0.02), 1) if base_pwr else 0,
        })

    today = round(base_pwr * 5.8, 1)
    total = round(today * 365 * (2 + random.random() * 3), 1)

    return {
        "sn":            f"B{2000+idx}{random.randint(100000,999999)}",
        "model":         model,
        "status":        st,
        "lastUpdate":    datetime.now().isoformat(),
        "runningStatus": "Running" if st == "online" else ("Warning" if st == "warning" else "Standby"),
        # AC
        "activePower":   base_pwr,
        "reactivePower": round(base_pwr * (1 - pf) * 0.3, 1),
        "apparentPower": round(base_pwr / pf, 1) if pf else base_pwr,
        "powerFactor":   pf,
        "frequency":     freq,
        "voltageA":      round(base_v_ac * (0.99 + random.random() * 0.02), 1),
        "voltageB":      round(base_v_ac * (0.99 + random.random() * 0.02), 1),
        "voltageC":      round(base_v_ac * (0.99 + random.random() * 0.02), 1),
        "voltageAB":     round(base_v_ac * 1.732 * (0.995 + random.random() * 0.01), 1),
        "voltageBC":     round(base_v_ac * 1.732 * (0.995 + random.random() * 0.01), 1),
        "voltageCA":     round(base_v_ac * 1.732 * (0.995 + random.random() * 0.01), 1),
        "currentA":      phase_a,
        "currentB":      round(phase_a * (0.99 + random.random() * 0.02), 1),
        "currentC":      round(phase_a * (0.99 + random.random() * 0.02), 1),
        # DC
        "totalDCPower":  round(base_pwr / pf * 1.02, 1),
        "busDCVoltage":  round(base_v_dc * 1.08, 1),
        "mppt":          mppts,
        "strings":       strings,
        # Energy
        "todayEnergy":   today,
        "totalEnergy":   total,
        # Thermal
        "tempInternal":  round(38 + random.random() * 18, 1) if st != "offline" else round(26 + random.random() * 5, 1),
        "tempHeatsink":  round(45 + random.random() * 20, 1) if st != "offline" else round(30 + random.random() * 5, 1),
        "tempModule":    None,
        "tempAmbient":   None,
        "irradiance":    round(650 + random.random() * 350, 0) if st != "offline" else 0,
        "efficiency":    round(97.5 + random.random() * 1.5, 1) if st != "offline" else 0,
        # Legacy compat
        "power":         base_pwr,
        "voltage_ac":    round(base_v_ac * 1.732, 1),
        "current_ac":    phase_a,
        "voltage_dc":    mppts[0]["voltage"] if mppts else 0,
        "current_dc":    mppts[0]["current"] if mppts else 0,
        "temperature":   round(38 + random.random() * 18, 1) if st != "offline" else 25,
        "rawCount":      len(SUNGROW_INVERTER_POINTS),
    }

# ---------------------------------------------------------------------------
# Period-over-Period comparison
# ---------------------------------------------------------------------------
@app.route("/api/plants/<plant_id>/period-compare")
@require_role()
def period_compare(plant_id, current_user):
    """
    Compare two date ranges for the same plant.
    Query params: p1_start, p1_end, p2_start, p2_end  (YYYYMMDD)
    """
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    p1_start = request.args.get("p1_start", "")
    p1_end   = request.args.get("p1_end", "")
    p2_start = request.args.get("p2_start", "")
    p2_end   = request.args.get("p2_end", "")

    if not all([p1_start, p1_end, p2_start, p2_end]):
        return jsonify({"error": "p1_start, p1_end, p2_start, p2_end required (YYYYMMDD)"}), 400

    try:
        dt_p1s = datetime.strptime(p1_start, "%Y%m%d")
        dt_p1e = datetime.strptime(p1_end,   "%Y%m%d")
        dt_p2s = datetime.strptime(p2_start, "%Y%m%d")
        dt_p2e = datetime.strptime(p2_end,   "%Y%m%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYYMMDD."}), 400

    def fetch_range(start_dt, end_dt):
        """Fetch daily energy for a date range using monthly chart API."""
        import random
        data = {}
        cur = start_dt.replace(day=1)
        while cur <= end_dt:
            month_key = cur.strftime("%Y%m")
            try:
                if USE_DEMO or not SUNGROW_APPKEY:
                    # Demo: generate plausible daily data
                    import calendar
                    _, days_in = calendar.monthrange(cur.year, cur.month)
                    for d in range(1, days_in + 1):
                        try:
                            date = cur.replace(day=d)
                        except ValueError:
                            break
                        if start_dt <= date <= end_dt:
                            data[date.strftime("%Y-%m-%d")] = round(400 * (0.75 + random.random() * 0.45), 1)
                else:
                    raw = client.get_chart_data(plant_id, month_key, "2", "p83022")
                    if raw and isinstance(raw, dict):
                        pts = raw.get("data_points", raw.get("points", []))
                        for idx, p in enumerate(pts):
                            try:
                                date = cur.replace(day=idx + 1)
                            except ValueError:
                                break
                            if start_dt <= date <= end_dt:
                                val = p.get("value")
                                if val is not None and val != "--":
                                    try:
                                        data[date.strftime("%Y-%m-%d")] = round(float(val), 1)
                                    except (ValueError, TypeError):
                                        pass
            except Exception as e:
                log.warning("Period compare fetch %s failed: %s", month_key, e)
            cur = cur.replace(month=cur.month % 12 + 1) if cur.month < 12 else cur.replace(year=cur.year + 1, month=1)
        return data

    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(fetch_range, dt_p1s, dt_p1e)
            f2 = ex.submit(fetch_range, dt_p2s, dt_p2e)
            d1, d2 = f1.result(), f2.result()

        days1, days2 = sorted(d1.keys()), sorted(d2.keys())
        series = []
        for i in range(max(len(days1), len(days2))):
            row = {"idx": i + 1,
                   "date1":   days1[i] if i < len(days1) else None,
                   "energy1": d1[days1[i]] if i < len(days1) else None,
                   "date2":   days2[i] if i < len(days2) else None,
                   "energy2": d2[days2[i]] if i < len(days2) else None}
            series.append(row)

        s1, s2  = sum(d1.values()), sum(d2.values())
        avg1    = s1 / len(d1) if d1 else 0
        avg2    = s2 / len(d2) if d2 else 0
        return jsonify({
            "plant_id": plant_id,
            "period1":  {"label": f"{dt_p1s.strftime('%d %b %Y')} – {dt_p1e.strftime('%d %b %Y')}",
                         "data":  [{"date": k, "energy": v} for k, v in sorted(d1.items())]},
            "period2":  {"label": f"{dt_p2s.strftime('%d %b %Y')} – {dt_p2e.strftime('%d %b %Y')}",
                         "data":  [{"date": k, "energy": v} for k, v in sorted(d2.items())]},
            "series":   series,
            "summary": {
                "p1Total": round(s1, 1), "p2Total": round(s2, 1),
                "p1Avg":   round(avg1, 1), "p2Avg": round(avg2, 1),
                "p1Best":  round(max(d1.values(), default=0), 1),
                "p2Best":  round(max(d2.values(), default=0), 1),
                "change":  round((s2 - s1) / s1 * 100, 1) if s1 else None,
                "days1":   len(d1), "days2": len(d2),
            },
        })
    except Exception as e:
        log.error("Period compare failed: %s", e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Intraday active power curve (kW at 15-min intervals)
# ---------------------------------------------------------------------------
@app.route("/api/plants/<plant_id>/power-curve")
@require_role()
def plant_power_curve(plant_id, current_user):
    """Today's (or any date's) intraday active power curve at 15-min resolution."""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    date_str = request.args.get("date", datetime.now().strftime("%Y%m%d"))
    date_fmt = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"

    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            return jsonify({"data": _demo_power_curve(date_fmt), "unit": "kW", "date": date_fmt})

        try:
            raw = client.get_chart_data(plant_id, date_str, "1", "p83001")
            if not raw or not isinstance(raw, dict) or not raw.get("data_points"):
                raw = client.get_chart_data(plant_id, date_str, "1", "p83022")
            data = _parse_chart_points(raw, date_fmt, interval_min=15)
        except Exception:
            data = []

        if not data:
            return jsonify({
                "data": [], "unit": "kW", "date": date_fmt,
                "unavailable": True,
                "reason": "Chart data (getPowerChartData) requires API Level 2 permissions in iSolarCloud.",
            })
        return jsonify({"data": data, "unit": "kW", "date": date_fmt})
    except Exception as e:
        log.error("Power curve failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e), "data": []}), 500


def _demo_power_curve(date_fmt):
    import random, math
    data = []
    for h in range(6, 19):
        for m in (0, 15, 30, 45):
            frac   = (h - 6 + m / 60) / 12.5
            cloud  = random.random()
            cfac   = 1.0 if cloud > 0.18 else (0.35 + cloud * 3.6)
            val    = round(max(0, 180 * math.sin(math.pi * frac) * cfac + random.uniform(-4, 4)), 1)
            data.append({"ts": f"{date_fmt}T{h:02d}:{m:02d}:00", "value": val})
    return data


# ---------------------------------------------------------------------------
# Per-plant delta KPIs (yesterday, last month)
# ---------------------------------------------------------------------------
@app.route("/api/plants/<plant_id>/kpis")
@require_role()
def plant_kpis(plant_id, current_user):
    """Returns today vs yesterday, this month vs last month energy deltas."""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    now = datetime.now()

    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            import random
            today_e      = round(300 + random.random() * 250, 1)
            yest_e       = round(today_e * (0.82 + random.random() * 0.36), 1)
            last_m_days  = (now.replace(day=1) - timedelta(days=1)).day
            this_month_e = round(today_e * now.day * (0.92 + random.random() * 0.16), 1)
            last_month_e = round(today_e * last_m_days * (0.88 + random.random() * 0.24), 1)
            return jsonify({
                "today":     today_e,
                "yesterday": yest_e,
                "thisMonth": this_month_e,
                "lastMonth": last_month_e,
                "todayDelta":     round((today_e - yest_e) / yest_e * 100, 1) if yest_e else None,
                "monthDelta":     round((this_month_e - last_month_e) / last_month_e * 100, 1) if last_month_e else None,
            })

        # Get today from plant summary cache (always available)
        plants  = client._cached("all_plants_summary", client._fetch_all_plants_summary, ttl=300)
        plant   = next((p for p in plants if str(p.get("id")) == str(plant_id)), {})
        today_e = plant.get("todayEnergy", 0) or 0

        # Try chart data for yesterday/month comparisons (needs API Level 2)
        yest_e = None; this_m_e = None; last_m_e = None
        chart_available = False
        try:
            yest = now - timedelta(days=1)
            with ThreadPoolExecutor(max_workers=3) as ex:
                f_yest = ex.submit(client.get_chart_data, plant_id, yest.strftime("%Y%m%d"), "1", "p83022")
                f_this = ex.submit(client.get_chart_data, plant_id, now.strftime("%Y%m"),    "2", "p83022")
                f_last = ex.submit(client.get_chart_data, plant_id,
                                   (now.replace(day=1) - timedelta(days=1)).strftime("%Y%m"), "2", "p83022")
                raw_yest, raw_this, raw_last = f_yest.result(), f_this.result(), f_last.result()

            yest_pts   = _parse_chart_points(raw_yest, yest.strftime("%Y-%m-%d"), 15)
            this_m_pts = _parse_chart_points_monthly(raw_this, now.year, now.month)
            last_m_dt  = now.replace(day=1) - timedelta(days=1)
            last_m_pts = _parse_chart_points_monthly(raw_last, last_m_dt.year, last_m_dt.month)

            if yest_pts or this_m_pts:
                chart_available = True
                yest_e   = round(sum(p["value"] for p in yest_pts), 1)
                this_m_e = round(sum(p["value"] for p in this_m_pts), 1)
                last_m_e = round(sum(p["value"] for p in last_m_pts), 1)
        except Exception:
            pass  # chart data unavailable (API Level 1)

        # Fetch per-plant tariff from getPowerStationDetail (cached 10 min)
        plant_tariff = None
        try:
            detail = client.get_plant_detail(plant_id)
            raw_price = (detail.get("ps_price_kwh") or detail.get("price_kwh") or
                         detail.get("electricity_price"))
            if raw_price:
                plant_tariff = _safe_float(raw_price) or None
        except Exception:
            pass

        return jsonify({
            "today":        today_e,
            "yesterday":    yest_e,
            "thisMonth":    this_m_e or plant.get("monthEnergy"),
            "lastMonth":    last_m_e,
            "todayDelta":   round((today_e - yest_e) / yest_e * 100, 1) if yest_e else None,
            "monthDelta":   None,
            "chartAvailable": chart_available,
            # Extra live fields from plant summary
            "equivalentHours":   plant.get("equivalentHours"),
            "todayIncomeActual": plant.get("todayIncomeActual"),
            "yearIncomeActual":  plant.get("yearIncomeActual"),
            "totalIncomeActual": plant.get("totalIncomeActual"),
            "co2Today":          plant.get("co2Today"),
            "alarmCount":        plant.get("alarmCount", 0),
            "faultCount":        plant.get("faultCount", 0),
            "lastUpdated":       plant.get("lastUpdated"),
            # Per-plant configured tariff (from getPowerStationDetail)
            "tariffPerKwh":      plant_tariff or plant.get("tariffPerKwh"),
        })
    except Exception as e:
        log.error("KPIs failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Per-plant monthly / yearly energy charts
# ---------------------------------------------------------------------------
@app.route("/api/plants/<plant_id>/monthly-chart")
@require_role()
def plant_monthly_chart(plant_id, current_user):
    """Monthly energy breakdown: daily bars for current month + past 11 months summary."""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403

    now = datetime.now()
    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            import random
            monthly = []
            for i in range(12):
                d = now.replace(day=1) - timedelta(days=30 * (11 - i))
                monthly.append({
                    "month": d.strftime("%b %Y"),
                    "energy": round(8000 + random.random() * 6000, 0),
                })
            daily = []
            for day in range(1, now.day + 1):
                daily.append({
                    "date": f"{now.year}-{now.month:02d}-{day:02d}",
                    "energy": round(200 + random.random() * 300, 1),
                })
            return jsonify({"monthly": monthly, "daily": daily})

        # Fetch current month daily + 12-month summary in parallel
        def fetch_month(year, month):
            raw = client.get_chart_data(plant_id, f"{year}{month:02d}", "2", "p83022")
            return _parse_chart_points_monthly(raw, year, month)

        def fetch_year(year):
            raw = client.get_chart_data(plant_id, str(year), "3", "p83022")
            return _parse_chart_points_yearly(raw, year)

        monthly_pts  = []
        futures = {}
        with ThreadPoolExecutor(max_workers=6) as ex:
            for i in range(12):
                d = (now.replace(day=1) - timedelta(days=30 * (11 - i)))
                futures[(d.year, d.month)] = ex.submit(fetch_month, d.year, d.month)
            daily_future = ex.submit(fetch_month, now.year, now.month)

        for i in range(12):
            d = (now.replace(day=1) - timedelta(days=30 * (11 - i)))
            pts = futures[(d.year, d.month)].result()
            total = round(sum(p["value"] for p in pts), 1)
            monthly_pts.append({"month": d.strftime("%b %Y"), "energy": total})

        daily = [{"date": p["ts"], "energy": p["value"]} for p in daily_future.result()]

        return jsonify({"monthly": monthly_pts, "daily": daily})
    except Exception as e:
        log.error("Monthly chart failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# AI Chatbot
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

@app.route("/api/chat", methods=["POST"])
@require_role()
def chat_endpoint(current_user):
    """Fleet-aware AI assistant powered by Claude."""
    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "AI chatbot not configured — add ANTHROPIC_API_KEY to .env"}), 503

    data     = request.get_json(silent=True) or {}
    question = (data.get("question") or data.get("message") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400

    try:
        import anthropic as ant

        plants = generate_demo_data() if (USE_DEMO or not SUNGROW_APPKEY) else client.get_all_plants_summary()
        plants = _filter_plants_for_user(plants, current_user)

        total_cap    = sum(p.get("capacity", 0) for p in plants)
        today_energy = sum(p.get("todayEnergy", 0) for p in plants)
        online       = sum(1 for p in plants if p.get("status") == "online")
        offline      = sum(1 for p in plants if p.get("status") == "offline")
        active       = [p for p in plants if p.get("performanceRatio")]
        avg_pr       = sum(p["performanceRatio"] for p in active) / len(active) if active else None
        total_alerts = sum(len(p.get("errors", [])) for p in plants)

        plant_list = [{
            "name": p.get("name"), "city": p.get("city"),
            "kWp": p.get("capacity"), "status": p.get("status"),
            "grade": p.get("grade"), "pr": p.get("performanceRatio"),
            "today_kWh": p.get("todayEnergy"), "alerts": len(p.get("errors", [])),
        } for p in plants]

        system_msg = f"""You are SolarBull AI — an expert solar energy analyst for SolarBull Energy's fleet monitoring platform in India.
Answer concisely with specific data. Give actionable recommendations.

FLEET SUMMARY (live data):
- Plants: {len(plants)} | Capacity: {total_cap:.0f} kWp
- Online: {online} | Offline: {offline}
- Today generation: {today_energy:.0f} kWh
- Fleet avg PR: {f"{avg_pr*100:.1f}%" if avg_pr else "N/A"}
- Active alerts: {total_alerts}
- Tariff: ₹{TARIFF_PER_KWH}/kWh | CO₂ factor: {CO2_KG_PER_KWH} kg/kWh

PLANT DATA (top 30):
{json.dumps(plant_list[:30], default=str)}

Guidelines: Use specific numbers. Flag plants needing attention. Be concise (3-5 sentences unless asked for more detail)."""

        ant_client = ant.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp       = ant_client.messages.create(
            model="claude-opus-4-6", max_tokens=1024,
            system=system_msg,
            messages=[{"role": "user", "content": question}],
        )
        return jsonify({"answer": resp.content[0].text})

    except Exception as e:
        log.error("Chat failed: %s", e)
        return jsonify({"error": str(e)}), 500


# Legacy Sungrow login (kept for compatibility — credentials come from .env in normal use)
@app.route("/api/login", methods=["POST"])
def api_legacy_login():
    data = request.get_json(silent=True) or {}
    global SUNGROW_USERNAME, SUNGROW_PASSWORD
    un = data.get("username", SUNGROW_USERNAME)
    pw = data.get("password", SUNGROW_PASSWORD)
    if not un or not pw:
        return jsonify({"error": "Username and password required"}), 400
    SUNGROW_USERNAME = un
    SUNGROW_PASSWORD = pw
    try:
        client.login()
        return jsonify({"success": True, "userId": client.user_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 401


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
# SOLARBULL-IMPROVEMENT: Task 5 — health poll tracking globals
_last_poll_time  = None
_last_poll_count = 0

# SOLARBULL-IMPROVEMENT: Task 2 — APScheduler background poll function
def scheduled_poll():
    global _last_poll_time, _last_poll_count
    try:
        t0 = time.time()
        plants = client.get_all_plants_summary()
        _last_poll_time  = datetime.utcnow().isoformat() + "Z"
        _last_poll_count = len(plants)
        log.info("Scheduled poll complete: %d plants in %.2fs", len(plants), time.time() - t0)
    except Exception as e:
        log.error("Scheduled poll failed: %s", e)

def _prewarm_cache():
    """Pre-warm the plant summary cache in background so first user request is instant."""
    import threading
    def warm():
        try:
            log.info("Pre-warming plant cache...")
            t0 = time.time()
            plants = client.get_all_plants_summary()
            global _last_poll_time, _last_poll_count
            _last_poll_time  = datetime.utcnow().isoformat() + "Z"
            _last_poll_count = len(plants)
            log.info("Cache warm: %d plants in %.2fs", len(plants), time.time() - t0)
        except Exception as e:
            log.warning("Cache pre-warm failed: %s", e)
    threading.Thread(target=warm, daemon=True).start()


if __name__ == "__main__":
    mode = "DEMO" if USE_DEMO or not SUNGROW_APPKEY else "LIVE"
    log.info("=" * 60)
    log.info("SolarBull Energy Dashboard — Backend")
    log.info("Mode: %s | Port: %s | Cache TTL: %ss", mode, PORT, CACHE_TTL)
    log.info("=" * 60)

    init_db()

    if mode == "LIVE":
        try:
            client.login()
            _prewarm_cache()   # start filling cache immediately in background
        except Exception as e:
            log.error("Initial Sungrow login failed: %s", e)

        # SOLARBULL-IMPROVEMENT: Task 2 — APScheduler background polling every 10 min
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            scheduler = BackgroundScheduler()
            scheduler.add_job(scheduled_poll, "interval", minutes=10, id="plant_poll")
            scheduler.start()
            log.info("Background scheduler started — polling every 10 minutes.")
        except ImportError:
            log.warning("APScheduler not installed — background polling disabled. Run: pip install apscheduler")
        except Exception as e:
            log.error("Failed to start scheduler: %s", e)

    app.run(host="0.0.0.0", port=PORT, debug=False)
