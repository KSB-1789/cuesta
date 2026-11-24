const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cuestaDesktop', {
  isDesktop: true,
  runAction: (action, key, targetAppId) => ipcRenderer.invoke('cuesta:action', { action, key, targetAppId }),
  runDeviceCommand: (command) => ipcRenderer.invoke('cuesta:device-cmd', { command }),
  toggleDictation: (provider) => ipcRenderer.invoke('cuesta:dictation:toggle', { provider }),
  setDictationMode: (mode) => ipcRenderer.send('cuesta:dictation:mode', { mode }),
  getSpeechStatus: () => ipcRenderer.invoke('cuesta:speech:status'),
  restartSpeechEngine: () => ipcRenderer.invoke('cuesta:speech:restart'),
  onSpeechStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('cuesta:speech:status', handler)
    return () => ipcRenderer.removeListener('cuesta:speech:status', handler)
  },
  pasteExternalText: (text) => ipcRenderer.invoke('cuesta:clipboard:paste-text', { text }),
  onDictationStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('cuesta:dictation:status', handler)
    return () => ipcRenderer.removeListener('cuesta:dictation:status', handler)
  },
  launchApp: (appId, customPath) => ipcRenderer.invoke('cuesta:app:launch', { appId, customPath }),
  pickCustomExe: () => ipcRenderer.invoke('cuesta:app:pick-exe'),
  clickUiElement: (targetName) => ipcRenderer.invoke('cuesta:ui:click-name', { targetName }),
  listUiElements: () => ipcRenderer.invoke('cuesta:ui:elements'),
  getForegroundInfo: () => ipcRenderer.invoke('cuesta:foreground:info'),
  getOllamaStatus: () => ipcRenderer.invoke('cuesta:ollama:status'),
  cleanTranscriptWithAi: (text, model) => ipcRenderer.invoke('cuesta:ollama:clean-text', { text, model }),
  parseControlIntentWithAi: (phrase, model, appNames) =>
    ipcRenderer.invoke('cuesta:ollama:parse-intent', { phrase, model, appNames }),
  setWindowMode: (mode) => ipcRenderer.invoke('cuesta:window:mode', mode),
  onWindowModeChanged: (callback) => {
    const handler = (_event, mode) => callback(mode)
    ipcRenderer.on('cuesta:window:mode-changed', handler)
    return () => ipcRenderer.removeListener('cuesta:window:mode-changed', handler)
  },
  syncHudState: (snapshot) => ipcRenderer.send('cuesta:hud:state', snapshot),
  onHudState: (callback) => {
    const handler = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('cuesta:hud:state', handler)
    return () => ipcRenderer.removeListener('cuesta:hud:state', handler)
  },
  sendHudCommand: (command) => ipcRenderer.send('cuesta:hud:command', command),
  onHudCommand: (callback) => {
    const handler = (_event, command) => callback(command)
    ipcRenderer.on('cuesta:hud:command', handler)
    return () => ipcRenderer.removeListener('cuesta:hud:command', handler)
  },
  moveHudBy: (dx, dy) => ipcRenderer.send('cuesta:hud:move-by', { dx, dy }),
  moveCursorNorm: (nx, ny) => ipcRenderer.send('cuesta:cursor:move-norm', { nx, ny }),
  moveCursor: (x, y) => ipcRenderer.send('cuesta:cursor:move', { x, y }),
  cursorClick: (kind) => ipcRenderer.invoke('cuesta:cursor:click', { kind }),
  onShortcut: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('cuesta:hotkey', handler)
    return () => ipcRenderer.removeListener('cuesta:hotkey', handler)
  },
})
