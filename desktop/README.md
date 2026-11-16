# Cuesta for Windows

Cuesta for Windows is the primary product path. It is an Electron desktop app, not a localhost site and not an extension.

## What it does

- Runs the self-hosted MediaPipe Face Landmarker locally from the webcam.
- Learns a neutral baseline, then a personal signal from three repetitions.
- Runs the trained detector continuously after a profile is saved.
- Uses hold time, sensitivity, hysteresis, and cooldown before triggering.
- Sends actions to the foreground Windows application through a native PowerShell/user-input bridge:
  - select: Enter
  - next/previous: Tab / Shift+Tab
  - scroll up/down: Page Up / Page Down
  - back: Alt+Left
  - key press: the configured key
- Toggles Windows Speech Recognition dictation with the exact **Ctrl+Win** chord, then pastes the recognized text into the foreground app.
- Uses **Ctrl+Win+Space** to select the current highlighted item.

## Build a Windows app

On a Windows machine with Node.js installed:

```powershell
npm install
npm run desktop:win
```

The portable executable is written to `release/Cuesta-0.1.0-Windows.exe`. It can be run without VS Code and without a local web server.

For development:

```powershell
npm install
npm run desktop:run
```

## Windows permissions and speech

The first run needs camera permission. Dictation uses the Windows `System.Speech` recognition engine and the default microphone. Cuesta uses a native Windows keyboard hook because Electron’s normal global shortcut API cannot bind a modifier-only chord. If Windows Speech Recognition or the selected language pack is unavailable, Cuesta reports that instead of silently pretending dictation worked.

The Windows bridge is intentionally explicit: ordinary browser pages cannot control arbitrary foreground applications. Cuesta’s desktop build is what provides that capability. The OS may still block elevated/admin windows or secure surfaces; those are Windows security boundaries, not Cuesta failures.
