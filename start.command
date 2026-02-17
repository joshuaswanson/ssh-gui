#!/bin/bash
cd "$(dirname "$0")"
open -a Safari "http://localhost:8022" &
exec uv run app.py
