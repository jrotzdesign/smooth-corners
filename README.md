# Smooth Corners for Illustrator

Figma-style corner smoothing for Illustrator 2024, 2025 and 2026, plus a fuller single-curve **Full** corner, size presets (including Fibonacci), per-corner radii, and corners that survive scaling.

## Install (macOS)

1. Unzip, then double-click **Install Smooth Corners (Mac).command**. If macOS blocks it, right-click it and choose Open.
2. Quit Illustrator and open it again.
3. Open the panel from **Window → Extensions → Smooth Corners**.

The installer also tries to add the dialog version to **File → Scripts**. If it can't write to that folder, you can always run it from **File → Scripts → Other Script… → SmoothCorners.jsx**.

For a keyboard shortcut, use **Edit → Keyboard Shortcuts → Menu Commands → Scripts → SmoothCorners**.

On Windows, run **Install Smooth Corners (Windows).bat** instead.

## What the installer changes

Read this before you run it. Smooth Corners is a free, home-made panel, so it isn't signed through Adobe. To make Illustrator load it, the installer:

- copies the panel into your user's Adobe CEP extensions folder (no admin password);
- turns on Adobe's **PlayerDebugMode** setting (CSXS 9–14), which lets Illustrator load unsigned panels. It's a per-user preference, and it applies to every unsigned panel, not only this one;
- on macOS, removes the download-quarantine flag from the copied panel folder so Gatekeeper doesn't block it;
- on macOS, tries to copy the two `.jsx` scripts into Illustrator's Scripts folder.

It doesn't connect to the internet, collect data, or need admin rights. Run the **Uninstall** file to remove it. The uninstaller leaves PlayerDebugMode on because other panels may need it; to turn it off on macOS, run `for v in 9 10 11 12 13 14; do defaults delete com.adobe.CSXS.$v PlayerDebugMode; done`.

## Using it

1. Select one or more paths. Groups and compound paths work too.
2. Pick a **Style**:
   - **iOS** is Figma's 60% smoothing. The panel opens on this one.
   - **Full** is a fuller single curve: one curve per corner with its handles at 69.2% of the corner length. A circle uses 55.2%.
   - **Max smooth** is Figma's 100%.
   - **Circle** is Illustrator's normal round corner.
3. Pick a size preset or type a radius:
   - **Doubling**: 2.5, 5, 10, 20, 40
   - **Fine**: 2, 4, 6, 8, 12, 16, 24
   - **Fibonacci**: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144
   - **% of side**: 5, 10, 20, 30% of the shape's shortest side
4. With **Live** on, the artwork updates as you drag the slider.

For example, the Full style at 2.5 pt on a 90° corner gives: anchor (0, 2.5), handle (0, 4.23), handle (0.77, 5), anchor (2.5, 5).

### Selecting a shape shows its settings

When you select a shape rounded with Smooth Corners, the panel switches to that shape's own settings: style, smoothing or curve fullness, unit, which corners are rounded, and the size of each. This works like Figma showing a layer's radius.

- Selecting a shape only displays its settings; it never changes the shape.
- Any edit you make from there applies to that shape, starting from what it already has.
- Selecting a shape that isn't rounded yet keeps the panel's current settings.
- If you select several rounded shapes, the panel shows the first one.
- The dialog (File → Scripts → SmoothCorners) also opens with the selected shape's settings.
- Size presets use whatever unit you're working in, so clicking 8 while in mm gives 8 mm.

### Choosing which corners

There are two ways to round only some corners.

**The corner picker** (panel and dialog) is meant for rectangles and icons:

- Click a corner in the little square and only that corner gets rounded. Click more corners to add them, and click a picked corner again to make it sharp.
- Corners you don't pick stay sharp. **All corners** puts all four back.
- Turn on **Different size per corner** to give each picked corner its own radius, like Figma's independent corners. A size of 0 leaves that corner sharp.
- With different sizes on, clicking a size preset fills whichever field is highlighted.
- On shapes that aren't rectangles, each corner counts toward the nearest corner of the shape's bounding box.

**Direct Selection** works on any shape:

- Use the Direct Selection tool (A) to select just the anchors you want, then apply. Only those corners change.
- The selection stays the same while you drag sliders, so live updates keep hitting the same corners.
- This also works together with the picker.

### What it rounds

- **Only straight-edge corners.** Curved points and curved segments are left exactly as they are.
- **Any angle.** It works on triangles, hexagons, stars and inward-pointing corners. On a short edge the radius shrinks automatically, the same way Figma handles it, so corners never overlap.

### Scaling without distorting corners

When you scale or stretch a rounded shape, Illustrator stretches the corners with it. Smooth Corners rebuilds them clean at the right radius, and it works whether you use the Selection tool, the Scale tool, the Transform panel or a group.

Under **When I scale a shape** in the panel, pick one:

- **Keep corners** (the default): corners keep their exact radius. A 5 pt corner stays 5 pt even when the shape gets 4× wider.
- **Scale corners**: corners grow and shrink with the shape and never get stretched out of shape. Uniform scaling stays as it is; a non-uniform stretch gets corners at the average scale.
- **Off**: Illustrator's normal behavior.

How it works in practice:

- **Automatic.** While the panel is open, a stretched shape's corners are rebuilt as soon as you click off it. The tool never changes a shape while it's still selected, because doing that collides with Illustrator's Bounding Box tool (Error:PARM). To rebuild while it's still selected, press **Fix now**.
- **Undo works normally.** Press Undo twice to go back to before the scale: the first Undo removes the fix and the second removes the scale. A shape you've undone back to stretched isn't fixed again.
- **Not selected anymore?** Click **Fix scaled corners in the whole document**.
- **Using the dialog instead of the panel?** Run **File → Scripts → SmoothCorners-FixScaled**. It fixes the selection, or the whole document if nothing is selected. Give it a shortcut under Edit → Keyboard Shortcuts → Menu Commands → Scripts.
- **% of side radii** always follow the new size of the shape.
- **Moving, rotating and flipping** never need a fix; they're left alone.
- **Hand-edited shapes** (anchors moved one by one) are treated as new artwork.

### Changing it later

Every rounded path keeps its original shape and the settings for each corner in its **Note** (Window → Attributes).

- **Run it again** on the same shape to change the radius or style. It re-rounds from the original, so rounds never stack up.
- **Change one corner** by direct-selecting just that corner's points and applying. Other corners keep their previous rounding. This is how you mix radii on non-rectangular shapes.
- **Reset** restores the original sharp shape, at the shape's current size.
- **Moving, scaling, rotating and flipping** all keep this working.
- **Hand-editing** the points makes the tool treat the shape as new artwork. It will round whatever sharp corners it finds.

### Saved presets

In the panel, **+ Save current as preset** stores the current style and radius under a **Saved** tab.

## How the math works

**Smoothing mode** uses Figma's construction, extended from 90° to any corner angle:

- The corner is a circular arc that covers `(1 − smoothing)` of the turn.
- A cubic Bézier on each side eases the curvature from 0 at the straight edge up to the curvature of the arc.
- The corner reaches `r·tan(θ/2)·(1 + smoothing)` along each edge.

Compared with the published Figma numbers for 90° corners, the results match to within 1e-5.

**Full mode** draws a single cubic per corner with handles at `k × corner length`. The Full preset uses k = 0.692. Compared with a circle, it is fuller at the corner's midpoint (34% of the radius from the sharp vertex, against 41% for a circle) and joins the straight edges more gently.

## Files

| Path | What it is |
|---|---|
| `SmoothCorners.jsx` | Standalone script with a live-preview dialog |
| `SmoothCorners-FixScaled.jsx` | One-shot script that rebuilds stretched corners (good on a keyboard shortcut) |
| `cep/com.jro.smoothcorners/` | Dockable panel (CEP) |
| `Install …` / `Uninstall …` | Installers and uninstallers for macOS and Windows |
| `LICENSE` | MIT license |

CEP panels still work in Illustrator 2026. Adobe plans to retire CEP panels in favor of UXP; the standalone `.jsx` script isn't affected.

## License

MIT © 2026 Jose R. Ortiz / JRO Design. Free to use, change and share. See `LICENSE`.
