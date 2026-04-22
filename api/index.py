import sys
import os

# Add project root to Python path so server.py is importable.
# In Vercel's Lambda, __file__ resolves to /var/task/api/index.py,
# so two dirname() calls give /var/task (the project root).
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

# Vercel's filesystem is read-only except /tmp.
# SQLite data is ephemeral (reset on cold start) but init_db() re-seeds
# the admin user from env vars each time, so auth still works.
os.environ.setdefault("DB_PATH", "/tmp/solarbull.db")

try:
    from server import app, init_db
    init_db()
except Exception as _e:
    # Surface the real error in Vercel's function logs instead of
    # the generic "could not import" message.
    import traceback, logging
    logging.basicConfig(level=logging.ERROR)
    logging.error("Fatal import error in api/index.py:\n%s", traceback.format_exc())
    raise
