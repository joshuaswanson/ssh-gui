#!/bin/bash
cd "$(dirname "$0")"
nohup uv run app.py &>/dev/null &
disown
sleep 1
open -a Safari "http://localhost:8022"
exit 0
