# Cuesta for Windows — Project Guidelines

Desktop accessibility tool enabling personal hands-free switch control, global dictation, and allowlisted Windows application launching.

## Development & Test Commands

- **Run Web Dev Server:** `npm run dev` (Vite at http://localhost:5173)
- **Run Unit Tests:** `npm test` (Vitest test suite)
- **Compile & Typecheck:** `npm run build` (`tsc -b && vite build`)
- **Launch Windows Desktop App:** `npm run desktop:run`
- **Package Standalone Windows Executable:** `npm run desktop:win` (Outputs portable .exe to `release/`)

## Architecture & Code Rules

1. **Native Security:**
   - Never pass raw speech text or unsanitized strings to `powershell.exe` or `cmd.exe`.
   - All app launching must route through `src/lib/app-registry.ts` and `isValidCustomExe()`.
2. **Signal Pipeline:**
   - 55-feature vector: 52 facial blendshapes + head yaw/pitch/roll.
   - Normalized against individual 3-second resting baseline (`src/lib/signal.ts`).
   - Triggers require threshold hold time (150-600ms) with refractory cooldown (300-1500ms).
3. **Design & UX (HeyClicky / Cluely Inspired):**
   - Palette: Obsidian black (`#07090c`), frosted acrylic surfaces (`rgba(18, 24, 34, 0.72)`), Signal Emerald (`#22e584`), and Dictation Cyan (`#00f0ff`).
   - Supports two window modes: Full Studio (`1240x860`) and Compact Floating HUD dock (`420x130`).
   - Physical key chords: `<kbd>Ctrl</kbd> + <kbd>Win</kbd>` (Dictation) and `<kbd>Shift</kbd> + <kbd>Win</kbd>` (Reveal / HUD).
4. **File Ceilings:**
   - Keep files under 400 lines (strict 800-line soft ceiling).
   - Functions under 50 lines with single responsibilities.
