#!/bin/bash
# Builds "dist/SSH GUI.app". Requires uv and rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR=build/macos
ICONSET="$BUILD_DIR/icon.iconset"

# Apple's icon grid fills 824 of 1024 pixels, and the tile fills 248 of the
# logo's 256 units, so the logo spans 850.58 of the canvas. The Dock draws no
# shadow of its own, so the margin holds a baked one matching Apple's template.
ICON_SVG="$BUILD_DIR/icon.svg"

build_icon_svg() {
  {
    printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024">'
    printf '%s' '<defs><filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">'
    printf '%s' '<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.2"/>'
    printf '%s' '</filter></defs>'
    printf '<image x="86.71" y="86.71" width="850.58" height="850.58" filter="url(#shadow)" xlink:href="data:image/svg+xml;base64,%s"/></svg>' \
      "$(base64 < static/logo.svg | tr -d '\n')"
  } > "$ICON_SVG"
}

render_icon() {
  local canvas=$1 output=$2
  rsvg-convert "$ICON_SVG" --width "$canvas" --height "$canvas" --output "$output"
}

rm -rf "$BUILD_DIR" "dist/SSH GUI" "dist/SSH GUI.app"
mkdir -p "$ICONSET"
build_icon_svg
for size in 16 32 128 256 512; do
  render_icon "$size" "$ICONSET/icon_${size}x${size}.png"
  render_icon "$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil --convert icns "$ICONSET" --output "$BUILD_DIR/icon.icns"

uv run pyinstaller --noconfirm --distpath dist --workpath "$BUILD_DIR/pyinstaller" macos/ssh-gui.spec
rm -rf "dist/SSH GUI"

echo "Built dist/SSH GUI.app"
