# Smooth Corners 1.3.5 plan (Logo -> Full, default iOS)

Phase 1 only. Nothing has been changed.

## Findings that change the plan

1. **No style id is ever persisted.** The panel stores `sc.state` (localStorage) with `mode:"cubic"` + `k:69.2`, and `sc.saved` presets with `mode`/`k`. The active card is derived from mode + k (`main.js:88`), never from `id:"logo"`. Art tags (`[SC2 ... SC2]` in `path.note`) store `c`/`s` + numbers, never the word "logo". So **no migration is needed**: 1.3.4 art re-fixes and old saved presets load unchanged. I will still not rely on the id, and I'll add a tiny guard on load (if a stored value has `style === "logo"` map it to `"full"`), harmless if never hit.
   - Caveat: saved presets from 1.3.4 have `name: "Logo 69.2% · 2.5pt"` baked in as text. Those names will keep saying "Logo" on existing installs. Option: rewrite names that start with "Logo " to "Full " on load. I plan to do this.
2. **Default style only affects new installs.** `sc.state` already holds `mode:"cubic"` for existing users, so changing `DEFAULTS` will not flip their panel. To make the panel actually open on iOS for everyone, I'd bump the storage key (`sc.state` -> `sc.state2`) or run a one-time reset of `mode` on first launch of 1.3.5. Decision for you below.
3. **The site has no zip.** `src/data/lab.js:30` links to `github.com/jrotzdesign/smooth-corners/releases/latest/download/SmoothCorners.zip`. So "update the download" = publish a GitHub release v1.3.5 with an asset named `SmoothCorners.zip`. Also `version: '1.3.4'` at `lab.js:26`.
4. **Visibility conflict.** You called the plugin "public" but said the jrotzdesign repos stay private. A private repo's `releases/latest/download` link returns 404 for visitors. Need to know which is true before I release.
5. Portfolio working tree is **not clean**: `src/scripts/tuning.js` modified and `LAB-PLAN.md` untracked, both unrelated. I will commit only my files.
6. 1.3.4 zip lives at `~/Downloads/jro-lab/SmoothCorners-1.3.4.zip` (top folder `SmoothCorners-1.3.4/`, 20 entries, no `_to_delete/` exists anywhere yet). I'll mirror that layout, and move the old zip into `~/Downloads/jro-lab/_to_delete/`.

## User-facing strings to change

| File | Line | Now | New |
|---|---|---|---|
| cep/.../js/main.js | 9 | `label:"Logo"`, `sub:"fuller curve"` | `label:"Full"` (sub unchanged) |
| cep/.../js/main.js | 331 | status `"Logo " + k + "%"` | `"Full " + k + "%"` |
| cep/.../index.html | 170 | tick label `logo` | `full` |
| cep/.../js/engine-core.js, jsx/engine.jsx, both root .jsx | preset | `label:"Logo (PDF)"` | `label:"Full"` |
| SmoothCorners.jsx | 973 | `Logo curve (fuller single curve)` | `Full curve (fuller single curve)` |
| SmoothCorners.jsx | 1035 | button `Logo  69.2%` | `Full  69.2%` |
| README.md | 3, 32, 43, 60, 123 | Logo / logo shapes | Full, plain wording, no mention of your logo |

Also: the "rectangles / logos" comment (jsx:294) and "rectangles and logo shapes" (README:60) are generic shape talk, reworded to "rectangles and icons".

## Internal changes (comments / constants)

- `SC.K_LOGO` -> `SC.K_FULL` (value 0.692 untouched) in engine-core.js, engine.jsx, SmoothCorners.jsx, SmoothCorners-FixScaled.jsx. Every reference updated (lines 35, 407, 669, 680, 908 and 964 in the .jsx files).
- Comments at the file headers ("Logo corner preset", "logo-style corner") -> "full".
- Preset `id:"logo"` -> `id:"full"` (nothing stores it). Style card id likewise.
- Curve math: untouched.

## Left alone

- Portfolio `MotionCard.astro`, `prestige-*.json`: unrelated logo animations.
- The 1.3.4 tag format `[SC2 ...]` and its c/s codes.

## Default style -> iOS (60%)

- main.js `DEFAULTS`: `mode:"smooth"` (smoothing 60 already). Card order: put iOS first, Full second.
- SmoothCorners.jsx line 964 state: `mode:"smooth"`, smoothing SC.SMOOTH_IOS; the dialog's radio selection must follow. FixScaled has the same state line to check.
- Existing-user behavior: see decision 1.

## Version bump to 1.3.5

manifest.xml (bundle + extension, 2 places), engine-core.js / engine.jsx / 2x .jsx (header + `SC.VERSION`), index.html boot text. README and the installers have no version string, so there is nothing to bump there beyond a README mention if I add one. Zip: `SmoothCorners-1.3.5/` top folder, same file list as 1.3.4, output `~/Downloads/jro-lab/SmoothCorners-1.3.5.zip`.

## Portfolio

- `src/data/lab.js`: version `1.3.5`; alt text line 39 (button list), caption 44, line 47 and line 61 copy: Logo -> Full. Copy goes through Humanizer.
- Images: re-render the panel (avif + webp, 1x + 2x) and the styles image (it shows "Logo", so redo it); also check `og-smooth-corners.jpg`.
- Verify: build, Playwright at desktop and 390px, console errors, download link.

## Verification of the curve

Run the engine for 2.5 pt, 90 degree corner with Full: expect handles 4.23 / 0.77 (README example) plus a 1.3.4-tagged shape round-trip (scale, then re-fix).

## Decisions I need from you before "go"

1. **Existing users' panel state:** (a) reset to iOS once on first 1.3.5 launch (everyone sees iOS, loses their last-chosen style once), or (b) change the default only (new installs open on iOS, existing keep their last choice). I recommend (a), since you want the panel to open on iOS.
2. **Release visibility:** is `jrotzdesign/smooth-corners` public, or private? If private, the site's download link will not work for visitors. Options: make just this repo public, or host the zip from the portfolio (`public/downloads/SmoothCorners.zip`) and point `lab.js` there.
3. **Release mechanism:** the GitHub MCP is down (401), so I'd use `gh` for the push and release, if `gh` is authed. Okay to create the v1.3.5 release and push both repos after the secret scan, and deploy the portfolio with its usual command (wrangler/Pages)? I'll confirm the deploy command from the repo before running.
