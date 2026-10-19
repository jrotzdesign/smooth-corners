#!/bin/bash
# Smooth Corners — macOS installer for Illustrator 2024 / 2025 / 2026
# Double-click this file (if macOS blocks it: right-click → Open).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="com.jro.smoothcorners"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo ""
echo "  Smooth Corners — installer"
echo "  --------------------------"

# 1. Panel (CEP extension, per-user — no admin password needed)
mkdir -p "$DEST"
rm -rf "$DEST/$EXT_ID"
cp -R "$HERE/cep/$EXT_ID" "$DEST/"
xattr -dr com.apple.quarantine "$DEST/$EXT_ID" 2>/dev/null || true
echo "  ✓ Panel installed to: $DEST/$EXT_ID"

# 2. Allow unsigned panels (needed for any self-made CEP panel)
for v in 9 10 11 12 13 14; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null || true
echo "  ✓ PlayerDebugMode enabled (CSXS 9–14)"

# 3. Standalone script into each Illustrator's Scripts menu (best effort)
COPIED=0
for app in /Applications/Adobe\ Illustrator\ 20*; do
  [ -d "$app" ] || continue
  for sd in "$app"/Presets.localized/*/Scripts "$app"/Presets/*/Scripts; do
    [ -d "$sd" ] || continue
    if cp "$HERE/SmoothCorners.jsx" "$HERE/SmoothCorners-FixScaled.jsx" "$sd/" 2>/dev/null; then
      echo "  ✓ Script added to: $sd"; COPIED=1
    fi
  done
done
if [ "$COPIED" = "0" ]; then
  echo "  • Could not write to the Illustrator Scripts folder (needs admin)."
  echo "    You can still run it via File → Scripts → Other Script… → SmoothCorners.jsx"
fi

echo ""
echo "  Done. Quit and reopen Illustrator, then open:"
echo "    Window → Extensions → Smooth Corners      (panel)"
echo "    File → Scripts → SmoothCorners            (dialog)"
echo ""
read -n 1 -s -r -p "  Press any key to close…"
echo ""
