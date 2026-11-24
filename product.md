# Cuesta for Windows: Product Definition & Notes

Cuesta is a local-first Windows desktop accessibility tool that turns a person’s webcam, voice, and keyboard into a personal hands-free control layer.

The central idea: **the user teaches Cuesta to recognize a movement they can reliably make, then Cuesta maps that movement to a useful Windows action**.

## Product Experience

- **Tactile Desktop HUD:** Inspired by HeyClicky and Cluely. Features a full Switch Studio workbench as well as a compact, floating on-screen HUD pill that stays on top while using other Windows apps.
- **Personal Switch Mode:** Self-hosted MediaPipe Face Landmarker runs locally via WebAssembly, extracting 52 facial blendshapes + head yaw/pitch/roll. Normalized against the individual's neutral resting face.
- **Global Dictation Chord (`Ctrl + Win`):** Monitored through a Windows low-level keyboard hook. Pressing Ctrl+Win starts local `faster-whisper` dictation and pastes directly into the foreground app, automatically falling back to Windows `System.Speech.Recognition` when the neural engine is unavailable.
- **Command Surface (`Shift + Win`):** Instantly reveals or summons Cuesta and toggles the compact floating HUD.
- **Allowlisted App & Voice Intent Router:** Commands like `open Microsoft Edge`, `launch notepad`, `open calculator`, or custom user `.exe` binaries are executed safely via approved processes without arbitrary shell scripts.
- **Switch Scanning Arena:** Interactive testing ground with focus traversal, accessible controls, and simulated foreground targets.
- **Zero Cloud Dependence:** Works offline. Video frames remain in volatile memory. Profiles store numeric vectors only.
