#!/bin/bash
cd "$(dirname "$0")"
PORT=8022

if ! nc -z localhost "$PORT" 2>/dev/null; then
  nohup uv run app.py >"$HOME/Library/Logs/ssh-gui.log" 2>&1 &
  disown
  for _ in $(seq 1 50); do
    nc -z localhost "$PORT" 2>/dev/null && break
    sleep 0.2
  done
fi

open -a Safari "http://localhost:$PORT"
exit 0
