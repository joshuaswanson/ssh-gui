#!/bin/bash
# Builds "dist/SSH GUI.app". Requires uv and rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build/macos
ICONSET="$BUILD_DIR/icon.iconset"

# Apple's icon grid fills 824 of 1024 pixels, and the tile fills 248 of the
# logo's 256 units, so the logo is drawn at 0.8306 of the canvas.
render_icon() {
  local canvas=$1 output=$2
  local size=$((canvas * 8306 / 10000))
  local inset=$(((canvas - size) / 2))
  rsvg-convert static/logo.svg --width "$size" --height "$size" \
    --page-width "$canvas" --page-height "$canvas" \
    --left "$inset" --top "$inset" --output "$output"
}

rm -rf "$BUILD_DIR" "dist/SSH GUI" "dist/SSH GUI.app"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  render_icon "$size" "$ICONSET/icon_${size}x${size}.png"
  render_icon "$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil --convert icns "$ICONSET" --output "$BUILD_DIR/icon.icns"

uv run pyinstaller --noconfirm --distpath dist --workpath "$BUILD_DIR/pyinstaller" macos/ssh-gui.spec
rm -rf "dist/SSH GUI"

echo "Built dist/SSH GUI.app"
