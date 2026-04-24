import sys
import os

# includeFiles in vercel.json bundles server.py alongside this file.
# In the Lambda, __file__ is /var/task/api/index.py, so two dirname()
# calls reach /var/task (the project root) where server.py lives.
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

# /tmp is the only writable path in Vercel's Lambda filesystem.
os.environ.setdefault("DB_PATH", "/tmp/solarbull.db")

from server import app, init_db  # 'app' must be at top level for Vercel's scanner

init_db()
