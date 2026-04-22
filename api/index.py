import sys
import os

# Add project root to path so server.py is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Vercel's filesystem is read-only except /tmp — put the SQLite DB there.
# Data is ephemeral (reset on cold start), but init_db() re-seeds the admin
# user from ADMIN_USERNAME/ADMIN_PASSWORD env vars on every cold start.
os.environ.setdefault("DB_PATH", "/tmp/solarbull.db")

# Required env vars — must be set in Vercel Project Settings → Environment Variables:
#   JWT_SECRET        (openssl rand -hex 32)
#   ADMIN_PASSWORD    (your dashboard login password)
#   ADMIN_EMAIL       (your email)
#   SUNGROW_USERNAME  )
#   SUNGROW_PASSWORD  ) iSolarCloud credentials
#   SUNGROW_APPKEY    )
#   SUNGROW_APPSECRET )
#   ANTHROPIC_API_KEY (for AI chat)

from server import app, init_db

# Runs once per cold start: creates tables and seeds admin user
init_db()

# Vercel's @vercel/python builder looks for 'app' (Flask WSGI object)
