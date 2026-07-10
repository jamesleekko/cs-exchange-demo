# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An interactive prototype of a CS2-style "汰换合同" (trade-up contract): the user drags same-quality skins into a contract, confirms, and watches an animated forge sequence produce a higher-tier skin with a randomized profit/loss outcome. UI and code comments are in Chinese. This is a demo/prototype — there is no backend, no persistence, and no test suite.

## Commands

```bash
npm run dev        # Vite dev server on :5173 (auto-opens; allows *.trycloudflare.com hosts)
npm run build      # production build to dist/
npm run preview    # serve the built dist/

node scripts/gen-anvil-sound.mjs         # regenerate forge/anvil WAVs in public/sfx/ (procedural audio, no deps)
node scripts/gen-case-sound.mjs          # regenerate weapon-case WAVs (case-land/case-open) in public/sfx/
node scripts/gen-pen-check-variants.mjs  # generate pen-check sound variants into public/temp/ for audition
```

There is no linter or test runner configured. Validate changes manually with `npm run dev` and run `npm run build` before submitting. Commits use conventional prefixes (`feat:`, `fix:`).

## Architecture

The entire application lives in **`src/App.vue`** (~1350 lines, Vue 3 `<script setup>`, naive-ui components under a `darkTheme` + `themeOverrides` config provider). `src/main.js` just mounts it. When changing behavior, expect to edit App.vue.

App.vue is organized as:
- **Game data** (top of `<script setup>`): `RARITIES` (7 CS2 quality tiers with color + `need` count), `RARITY_ORDER`, `SKIN_POOL` (skins per tier), `BASE_PRICE`. These are the source of truth for the trade-up rules.
- **Core rules**: `generateOutcome(items, count)` produces the trade-up result strictly following CS2 logic — output tier is one above input, output skin is random from the next tier's pool, and profit/loss is a weighted random factor over input cost. `wearTier(float)` maps a float to the CS2 exterior grade (崭新出厂…战痕累累).
- **Selection state & validation**: `selected`, `activeRarity`, `currentNeed`, `canAdd`/`addItem`/`lockReason` enforce the rules — all inputs must share one quality; `need>0` tiers only (non-tradeable `gold` has `need=0`); `consumer`–`classified` need 10, `covert` needs 5.
- **View flow**: mutually exclusive phases toggled by refs — `showBuilder` → (`showProcess` | `showForge` | `showContract` → `showCase`) → `showResult`. `startCraft()` computes the outcome first, then dispatches to `startClassic()`, `startForge()`, or `startContract()` based on `animMode`. In contract mode, `startContract()`'s `onDone` chains into `startCase()` (weapon-case opening) before the result view.
- **Three animation modes** (`animMode`, default `'forge'`): `'classic'` is pure DOM/CSS card-collapse + particle explosion driven by `setTimeout` in App.vue; `'forge'` (熔炉锻造) and `'contract'` (合同签订) delegate to the three.js modules below.

Trade-up rule invariant: if you change tier counts, tradeability, or add tiers, update **both** `RARITIES` and `RARITY_ORDER` (and `SKIN_POOL`/`BASE_PRICE` for any new tradeable tier) together.

### three.js modules (`src/three/`)

- **`forge.js`** — the "熔炉锻造" confirm animation. `createForge(canvas)` returns `{ play, stop, resize, dispose }`. `play(opts)` runs one full timed sequence (投料 → 升火 → 落锤 → 产物) and drives the outside world through callbacks: `onIgnite`, `onPhase(text)`, `onStrike`, `onReveal`, `onDone`. App.vue uses these callbacks to play sounds, flash the stage edge, and switch to the result view. Uses `three/addons` postprocessing (UnrealBloom) and custom particle shaders.
- **`contract.js`** — the "合同签订" confirm animation, same handle shape (`{ play, stop, resize, dispose }`) and callback pattern (`onPhase`, `onPaper`, `onSign`, `onStamp`, `onDone`). The contract page is drawn frame-by-frame on an offscreen 2D canvas (Chinese text, per-item rarity colors, animated check-mark stroke and stamp) and mapped as a texture onto a 3D plane.
- **`case.js`** — the "武器箱开启" sequence that follows the contract animation. `createCase(canvas)` returns the same handle shape; `play({ color })` drops a CS2-style weapon case, then **waits for a user click** (internal Raycaster; the `.case-layer.show` CSS rule re-enables pointer events on the canvas) before opening the lid with rarity-colored inner glow/light column/motes. Callbacks: `onLand`, `onPhase(text)`, `onOpen`, `onGlow`, `onReveal`, `onDone`. The lid art is a 2D-canvas texture recolored per rarity on each `play()`.
- **`starfield.js`** — ambient background particles. `createStarField(canvas)` returns `{ dispose }`.

All are imperative handles created lazily/in `onMounted` and cleaned up in `onBeforeUnmount`/`resetAll`. Always call `dispose()` when tearing down to avoid leaking WebGL contexts and RAF loops. When adding a new animation mode, follow this same handle + timed-callback pattern and wire it into `animMode`/`animOptions`/`startCraft()`/`resetAll()`.

### Styles

- **`src/style.css`** — global (minified, single line) styles for the stage, builder, classic process animation, result view, keyframes (`boom`, `edgePulse`, `sheen`, `shake`), and responsive rules.
- App.vue `<style scoped>` overrides the layout, styles the material/contract cards, the forge overlay, and the animation-mode switch.

### Assets

Everything in `public/sfx/` and `public/temp/` is procedurally generated 16-bit PCM (synthesized from oscillators/noise, no third-party libs) — regenerate via the `scripts/*.mjs` generators rather than editing WAVs by hand. `public/temp/` holds audition variants (e.g. 20 stamp candidates); the chosen one is copied into `public/sfx/` for actual use.
