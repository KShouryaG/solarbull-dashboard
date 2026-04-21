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

# Auth / DB
JWT_SECRET        = os.getenv("JWT_SECRET", "solarbull-change-in-production")
JWT_EXPIRY_HOURS  = int(os.getenv("JWT_EXPIRY_HOURS", "24"))
DB_PATH           = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "solarbull.db"))
ADMIN_USERNAME    = os.getenv("ADMIN_USERNAME", "shourya")
ADMIN_PASSWORD    = os.getenv("ADMIN_PASSWORD", "solarbull2024")
ADMIN_NAME        = os.getenv("ADMIN_NAME", "Shourya Gupta")
ADMIN_EMAIL       = os.getenv("ADMIN_EMAIL", "shourya.prince1228@gmail.com")

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
CORS(app)

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

            summary = {
                "id":          pid,
                "name":        plant.get("ps_name", f"Plant {pid}"),
                "city":        plant.get("ps_location", ""),
                "country":     plant.get("country", "IN"),
                "capacity":    _sg_val(plant.get("total_capcity", 0)),
                "status":      _parse_plant_status(plant.get("ps_status", 1)),
                "todayEnergy": _sg_val(plant.get("today_energy", 0)),
                "monthEnergy": month_energy,
                "totalEnergy": _sg_val(plant.get("total_energy", 0)),
                "currentPower": _sg_val(plant.get("curr_power", 0), nullable=True),
                "co2":         _sg_val(plant.get("co2_reduce_total", plant.get("co2_reduce", 0))),
                "latitude":    plant.get("latitude", ""),
                "longitude":   plant.get("longitude", ""),
                "installDate": plant.get("install_date", ""),
                "devices": [{
                    "deviceSn":   device_sn,
                    "datalogSn":  plant.get("communication_dev_sn", ""),
                    "deviceType": "Inverter",
                    "model":      device_model,
                    "status":     _parse_plant_status(plant.get("ps_status", 1)),
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

            compute_plant_stats(summary)
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
def compute_plant_stats(plant: dict) -> dict:
    """Attach derived KPIs to a plant dict in-place. Returns the dict."""
    cap     = plant.get("capacity") or 0
    today_e = plant.get("todayEnergy") or 0
    total_e = plant.get("totalEnergy") or 0

    specific_yield   = round(today_e / cap, 3)            if cap > 0 else None
    perf_ratio       = round(specific_yield / PEAK_SUN_HOURS, 3) if specific_yield is not None else None
    capacity_factor  = round((today_e / (cap * 24)) * 100, 2)   if cap > 0 else None
    co2_avoided      = plant.get("co2") or round(total_e * CO2_KG_PER_KWH, 1)
    revenue_today    = round(today_e * TARIFF_PER_KWH, 2)

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
        "co2Avoided":       co2_avoided,
        "revenueToday":     revenue_today,
        "grade":            grade,
        "peakSunHours":     PEAK_SUN_HOURS,
        "tariffPerKwh":     TARIFF_PER_KWH,
    })
    return plant

# ---------------------------------------------------------------------------
# Error code reference
# ---------------------------------------------------------------------------
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
# Misc routes (public / no auth needed for health)
# ---------------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "mode": "demo" if USE_DEMO or not SUNGROW_APPKEY else "live",
        "timestamp": datetime.now().isoformat(),
    })

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
            plants = client.get_all_plants_summary()
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
            plants = client.get_all_plants_summary()
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
            all_plants = client.get_all_plants_summary()
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
    """Real-time inverter data for a plant."""
    if current_user["role"] != "admin":
        allowed = set(json.loads(current_user["plant_ids"] or "[]"))
        if plant_id not in allowed:
            return jsonify({"error": "Access denied"}), 403
    try:
        if USE_DEMO or not SUNGROW_APPKEY:
            import random
            return jsonify({"inverters": [_make_demo_inverter(i, plant_id) for i in range(random.randint(1, 4))]})
        devices = client.get_device_list(plant_id)
        rt      = client.get_device_realtime(plant_id)
        result  = []
        for d in (devices if isinstance(devices, list) else []):
            sn   = d.get("device_sn", "")
            rt_d = {}
            if isinstance(rt, dict):
                for entry in rt.get("devices", rt.get("list", [])):
                    if entry.get("device_sn") == sn:
                        rt_d = entry
                        break
            result.append({
                "sn":         sn,
                "model":      d.get("device_model_code", d.get("device_model", "")),
                "status":     _parse_device_status(d.get("dev_status", 1)),
                "power":      _sg_val(rt_d.get("p_ac", rt_d.get("pac", 0))),
                "voltage_ac": _sg_val(rt_d.get("u_ab", rt_d.get("vac", 0))),
                "current_ac": _sg_val(rt_d.get("i_a", rt_d.get("iac", 0))),
                "voltage_dc": _sg_val(rt_d.get("mppt_1_u", rt_d.get("vdc", 0))),
                "current_dc": _sg_val(rt_d.get("mppt_1_i", rt_d.get("idc", 0))),
                "temperature": _sg_val(rt_d.get("temp_inside", rt_d.get("temperature", 0))),
                "efficiency":  _sg_val(rt_d.get("efficiency", 0)),
                "todayEnergy": _sg_val(rt_d.get("e_day", 0)),
                "totalEnergy": _sg_val(rt_d.get("e_total", 0)),
                "frequency":   _sg_val(rt_d.get("f_ac", 0)),
                "lastUpdate":  d.get("rel_time", ""),
            })
        return jsonify({"inverters": result})
    except Exception as e:
        log.error("Inverter data failed for %s: %s", plant_id, e)
        return jsonify({"error": str(e)}), 500

def _make_demo_inverter(idx, plant_id):
    import random
    models = ["SG33CX", "SG50CX", "SG125HV", "SG10RT-V112"]
    statuses = ["online", "online", "online", "warning"]
    st = random.choice(statuses)
    pwr = round(20 + random.random() * 60, 1) if st == "online" else 0
    return {
        "sn":          f"B{2000+idx}{random.randint(100000,999999)}",
        "model":       models[idx % len(models)],
        "status":      st,
        "power":       pwr,
        "voltage_ac":  round(220 + random.random() * 20, 1),
        "current_ac":  round(pwr / 230 * 1000, 1) if pwr else 0,
        "voltage_dc":  round(600 + random.random() * 100, 1),
        "current_dc":  round(pwr / 700 * 1000, 1) if pwr else 0,
        "temperature": round(35 + random.random() * 20, 1),
        "efficiency":  round(97.5 + random.random() * 1.5, 1),
        "todayEnergy": round(pwr * 5.5, 1),
        "totalEnergy": round(pwr * 5.5 * 365 * 3, 1),
        "frequency":   round(49.8 + random.random() * 0.4, 2),
        "lastUpdate":  datetime.now().isoformat(),
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
def _prewarm_cache():
    """Pre-warm the plant summary cache in background so first user request is instant."""
    import threading
    def warm():
        try:
            log.info("Pre-warming plant cache...")
            t0 = time.time()
            plants = client.get_all_plants_summary()
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

    app.run(host="0.0.0.0", port=PORT, debug=False)
