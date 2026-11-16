# Cuesta

**Personal Hands-Free Control Layer & Neural Accessibility Instrument for Windows**

Cuesta is a local-first Windows desktop accessibility instrument that transforms an ordinary webcam, microphone, and keyboard into a high-precision, hands-free computer control layer. Designed for individuals with motor impairments, RSI, ALS, cerebral palsy, or anyone requiring ergonomic, hands-free computer operation, Cuesta bridges the gap between assistive switch technology and modern neural productivity tools.

Instead of forcing users into rigid pre-programmed gestures ("open mouth wide to click"), Cuesta learns what change from neutral looks like for each individual person through few-shot calibration. Paired with a dedicated local neural Whisper speech engine and Windows UI Automation, Cuesta enables full computer control, fluid dictation, and application navigation without touching a mouse or keyboard.

---

## Key Capabilities

### 1. Offline Neural Whisper Dictation
- **State-of-the-Art Local ASR:** Powered by `faster-whisper` (`Systran/faster-whisper-small` running quantized `int8` on CPU) with zero cloud dependencies and sub-200ms latency.
- **Continuous Fluid Dictation:** Captures uncompressed 16 kHz mono audio via `sounddevice`, utilizing an energy-based Voice Activity Detection (VAD) filter with a 200 ms pre-roll ring buffer so initial consonants are never clipped.
- **Natural Spoken Punctuation:** Automatically formats spoken punctuation commands (`"period"`, `"comma"`, `"question mark"`, `"new line"`, `"new paragraph"`), strips hesitation fillers (`"um"`, `"uh"`), and enforces sentence capitalization.
- **Preserved Windows Clipboard:** Pastes text directly into any active Windows application (Notepad, Word, Discord, Browser, VS Code) via `Ctrl+V`, seamlessly restoring your previous clipboard content after 240 ms.
- **Optional Local LLM Post-Processing:** Optionally routes utterances through a local Ollama instance (`qwen2.5:3b`) for context-aware grammar refinement and punctuation without internet access.

### 2. Device Control & Windows UI Automation
- **Spoken Window Management:** Hands-free window snapping (`"snap left"`, `"snap right"`), task switching (`"switch window"`), minimizing, maximizing, closing, and desktop toggling.
- **UI Element Targeting:** Connects to Windows `UIAutomationClient` to query visible interactive controls (buttons, links, text fields) on the foreground window. Speak `"click Submit"`, `"click Save"`, or `"click Cancel"` to trigger controls by visible text.
- **Strictly Allowlisted App Launcher:** Safely launch approved Windows executables (`"open edge"`, `"launch notepad"`, `"open calculator"`, `"open code"`, `"open spotify"`) or verified custom local `.exe` paths without arbitrary shell text execution.
- **Dictation vs. Control Separation:** Clear mode isolation prevents dictating words (such as `"calculator"`) from accidentally launching applications.

### 3. Personalized Facial Switch Studio
- **Local In-Memory Vision:** Self-hosted MediaPipe Face Landmarker WebAssembly executes in volatile memory. No video frames are ever recorded, cached, or transmitted over the network.
- **55-Feature Neutral Normalization:** Calibrates a 3-second neutral resting face, calculating baseline mean and standard deviation across 55 facial blendshapes and head pose coordinates (yaw, pitch, roll).
- **Few-Shot Movement Teaching:** Record 3 comfortable repetitions of any voluntary movement (brow raise, brow furrow, cheek puff, smile, mouth open, wink, or head tilt) to generate a personalized prototype vector.
- **Bilateral Symmetry & Hysteresis:** Isolated left/right wink detection, noise floor gating, and configurable hold/cooldown timers eliminate accidental triggers from breathing or involuntary micro-expressions.

### 4. Head Cursor Pilot
- **Proportional Head Tracking:** Smooth nose-tip coordinate tracking with exponential smoothing (EMA) and configurable deadzones for stable, jitter-free cursor steering.
- **Dwell Clicking:** Trigger clicks automatically by holding the cursor over a target, featuring an obsidian progress ring.
- **Instant Recenter:** Recenter cursor instantly via hotkey (`Alt+C`) or spoken command (`"recenter cursor"`).

### 5. Obsidian Tactile HUD & Studio Workbench
- **Ward / Impeccable Aesthetic:** Minimalist obsidian dark theme, hairline glassmorphic borders, electric emerald telemetry, and responsive audio volume meters.
- **Dual-View Design:** Seamlessly toggle between the 5-step Switch Studio calibration workbench and an ultra-compact, floating on-screen HUD pill (`Shift+Win`) that hovers unobtrusively over your work.

---

## Global Hotkeys

| Hotkey | Action | Scope |
|---|---|---|
| `Ctrl + Win` | Toggle Neural Dictation / Voice Control | Global (Modifier-only low-level hook) |
| `Shift + Win` | Toggle Compact Floating HUD / Studio Workbench | Global (Modifier-only low-level hook) |
| `Alt + C` | Toggle Head Cursor Pilot / Recenter | Global desktop shortcut |
| `Alt + P` | Pause / Resume all facial gesture switches | Global desktop shortcut |

---

## System Architecture

```
[ Web Camera ]                         [ Microphone ]
      │                                       │
      ▼                                       ▼
MediaPipe Face Landmarker (Local WASM)   sounddevice (16kHz Mono float32)
      │                                       │
55 Blendshapes + Head Pose (Pitch/Yaw/Roll)   Energy VAD + 200ms Pre-roll Ring Buffer
      │                                       │
Baseline Normalizer (3s Neutral)              faster-whisper (small, int8 CPU)
      │                                       │
Cosine Prototype Matcher + Symmetry Gate      Deterministic Punctuation & Formatting
      │                                       │ (Optional: Ollama qwen2.5:3b)
      ▼                                       ▼
Action Worker (desktop/action-worker.ps1) ───► Active Window Paste (Ctrl+V)
      ├─ Windows SendKeys / Mouse Input
      ├─ UI Automation (click elements by name)
      └─ Window Snap & Hotkey Orchestration
```

---

## Prerequisites & Installation

### Requirements
- **Operating System:** Windows 10 or Windows 11 (64-bit)
- **Node.js:** v18.0.0 or higher
- **Python:** v3.10 to v3.14 (64-bit)
- **Hardware:** Standard webcam and microphone

### 1. Install Node Dependencies
```powershell
npm install
```

### 2. Install Python Speech Dependencies
```powershell
pip install faster-whisper sounddevice numpy
```
*(On first launch, `faster-whisper` will automatically cache the `Systran/faster-whisper-small` model locally in `~/.cache/huggingface/hub/` for offline execution).*

### 3. Run the Desktop Application
```powershell
npm run desktop:run
```

### 4. Build Standalone Portable Binary
To build a standalone, single-executable portable installer:
```powershell
npm run desktop:win
```
The output executable will be created in `release/Cuesta-0.1.0-Windows.exe`.

---

## Running in the Browser (Preview Mode)
You can also run the web interface directly for browser testing:
```bash
npm run dev
```
Open `http://localhost:5173/?demo` in Chrome or Edge (Web Speech API will be used in place of the native Windows workers).

---

## Testing & Quality Assurance
The codebase includes a comprehensive Vitest unit test suite covering signal detection, head pointer mathematics, app registry intent parsing, dictation formatting, and settings migration:

```powershell
npm test
```

Type checking and production bundle verification:
```powershell
npx tsc --noEmit
npm run build
```

---

## Privacy & Security

- **Zero Cloud Video/Audio Ingestion:** All video frames are processed exclusively inside local WebAssembly memory and discarded immediately after blendshape extraction. Audio is processed by the resident Python Whisper process directly on your CPU.
- **No Keystroke Logging:** The low-level keyboard hook monitors specifically for modifier chords (`Ctrl+Win` and `Shift+Win`) without intercepting or capturing standard alphanumeric typing.
- **Sandboxed Execution:** Application launching is restricted to approved, validated Windows binaries or user-selected local paths with strict path sanitization. Arbitrary shell command strings are prohibited.
- **Portability:** Profiles and switch weights are saved locally in the browser's `localStorage` and can be exported/imported as standard JSON.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
