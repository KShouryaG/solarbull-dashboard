import os

# Vercel's filesystem is read-only except /tmp.
# init_db() re-seeds admin user from env vars on every cold start.
os.environ.setdefault("DB_PATH", "/tmp/solarbull.db")

# server.py is copied into api/ by the build command (cp server.py api/)
# so it lives in the same directory as this file — no sys.path tricks needed.
from server import app, init_db  # noqa: E402  — 'app' must be top-level for Vercel

init_db()
