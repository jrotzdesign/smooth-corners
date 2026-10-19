#!/bin/bash
# Removes the Smooth Corners panel and scripts. Leaves Adobe's PlayerDebugMode setting alone,
# because other unsigned panels you use may rely on it.
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.jro.smoothcorners"
for app in /Applications/Adobe\ Illustrator\ 20*; do
  for sd in "$app"/Presets.localized/*/Scripts "$app"/Presets/*/Scripts; do
    [ -d "$sd" ] || continue
    rm -f "$sd/SmoothCorners.jsx" "$sd/SmoothCorners-FixScaled.jsx" 2>/dev/null || true
  done
done
echo "✓ Smooth Corners removed. Restart Illustrator."
read -n 1 -s -r -p "Press any key to close…"; echo
