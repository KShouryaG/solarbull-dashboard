import sys
import os

# Add project root so server.py (bundled via includeFiles) is importable.
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

# Vercel's filesystem is read-only except /tmp.
os.environ.setdefault("DB_PATH", "/tmp/solarbull.db")

from server import app, init_db  # noqa: E402  — 'app' must be top-level for Vercel

init_db()
