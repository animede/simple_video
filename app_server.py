"""
app_server.py – マルチユーザー版エントリポイント

app.py のバックエンドをそのまま import し、SIMPLE_VIDEO_MULTI_USER=1 を
設定して起動するだけの薄いラッパーです。

使い方:
    SIMPLE_VIDEO_MULTI_USER=1 uvicorn app_server:app --host 0.0.0.0 --port 8090

または:
    bash start_server.sh
"""
from __future__ import annotations

import os

# セッション分離を有効化（app.py のインポート前に設定）
os.environ.setdefault("SIMPLE_VIDEO_MULTI_USER", "1")

# app.py の FastAPI app をそのままインポート
from app import app  # noqa: F401, E402

__all__ = ["app"]
