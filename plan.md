# Cuesta implementation plan

## Scope
Cuesta is a local-first Windows desktop accessibility instrument for training personal camera-based input switches. Scope includes camera setup, baseline calibration, three-repetition hands-free signal training, live verification, sensitivity/hold/cooldown tuning, action mapping, local profiles with JSON import/export, switch scanning arena, privacy proof, and a Cluely/HeyClicky floating HUD.

## Implementation approach
- React + TypeScript + Vite with plain CSS and no server-side dependencies.
- A small signal-learning module models the brief’s transparent approach: feature vectors, baseline normalization, prototype averaging, cosine similarity, smoothing, hold, hysteresis, and cooldown. The UI includes a local demo sensor so the complete product can be exercised even without camera hardware.
- Camera setup calls `getUserMedia` with video only and keeps frames in memory. The vision boundary is isolated in `src/lib/vision.ts` so a self-hosted MediaPipe Face Landmarker model can be enabled by placing the model/WASM assets under `public/models` and `public/wasm`; the MVP UI does not claim a fake cloud model.
- `localStorage` stores profiles and settings. Export/import uses a downloadable/uploadable JSON file. No analytics, accounts, backend, or third-party runtime script.
- A manual service worker caches the app shell and same-origin GET requests. A manifest provides install metadata.
- The playground owns its scan targets. Scan mode cycles through focusable elements, applies a strong highlight, and lets the selected switch activate the current target. This respects the browser boundary: the web app controls only its own page.

## Project structure
- `src/main.tsx`: app bootstrap, PWA registration.
- `src/App.tsx`: navigation, onboarding/training flow, live meter, profile management, settings, and playground.
- `src/styles.css`: responsive high-contrast visual system and motion.
- `src/lib/types.ts`: shared domain types.
- `src/lib/signal.ts`: baseline, prototype, similarity, smoothing, hold/cooldown logic.
- `src/lib/storage.ts`: local profile/settings persistence and demo profile.
- `src/lib/vision.ts`: camera feature-source boundary and local model readiness messaging.
- `public/manifest.webmanifest`, `public/sw.js`, `public/manus-routes.json`: PWA and route metadata.
- `README.md`, `product.md`: local run, privacy, limitations, and submission-facing product notes.

## Design direction
Three visual styles considered:
1. **Soft clinical utility** — warm white surfaces, ink-blue typography, and clear lime signals; probability 0.06.
2. **Quiet tactile instrument** — deep ink canvas, luminous chartreuse signal color, rounded “control desk” panels, and warm paper accents; probability 0.07.
3. **Playful neo-brutalist assistive tool** — hard borders, primary red, oversized type; probability 0.04.

Chosen: **Quiet tactile instrument**.

- **Design Movement:** a calm audio-engineering control desk fused with an accessible field notebook: tactile surfaces, visible meters, and unmistakable state changes.
- **Core Principles:** reduce cognitive load; show what the system knows; make every action recoverable; treat privacy as a visible feature.
- **Color Philosophy:** deep ink gives long sessions a calm visual anchor; warm paper keeps reading areas gentle; chartreuse is reserved for a detected signal and focus; ember red is reserved for warnings and delete actions.
- **Layout Paradigm:** a left rail for orientation and a wide, asymmetric workbench. Pages begin with a short eyebrow and strong headline, then place the main task in a broad panel with a narrow “signal notes” column.
- **Signature Elements:** the Cuesta “C” mark as a split-ring signal; live detection bars with a lime threshold line; numbered step chips that look like physical labels.
- **Interaction Philosophy:** no time-limited setup steps, explicit progress, large targets, keyboard-friendly focus, and “I’m ready” actions rather than hidden auto-advances.
- **Animation:** only purposeful motion: meter breathing, scan highlight gliding, and panel entrances under 240ms. Respect `prefers-reduced-motion`.
- **Typography System:** system sans stack for dependable offline rendering; oversized display headlines with tight tracking, compact uppercase labels, and comfortable 1.65 body leading.
- **Brand Essence:** a personal switch that adapts to the person, not the other way around. Personality: grounded, capable, humane.
- **Brand Voice:** plainspoken and reassuring. Example lines: “Your signal. Your pace.” and “Nothing leaves this device.”
- **Wordmark & Logo:** a lowercase `cuesta` wordmark paired with a split-ring C: two offset arcs representing baseline and signal.
- **Signature Brand Color:** `#c7f36b`, the Cuesta signal lime.

## Delivery decisions
Delivered as a local-first Windows desktop instrument powered by Electron and a high-performance Win32 native action dispatcher, packaged with portable standalone binary capability and instant Vite dev mode.
