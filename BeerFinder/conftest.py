"""Pytest bootstrap: ensure the project root is importable so that
``import backend.xxx`` resolves regardless of the directory pytest is invoked
from (the backend is a namespace package rooted here)."""

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
