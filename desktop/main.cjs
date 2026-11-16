const { app, BrowserWindow, Menu, globalShortcut, ipcMain, clipboard, session, dialog, screen } = require('electron')

// Keep stderr clean from non-fatal Chromium GPU logs without altering native DWM compositing
app.commandLine.appendSwitch('log-level', '3')

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.moveTop()
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })
}

const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

let mainWindow = null
let hudWindow = null
let chordProcess = null
let actionWorkerProcess = null
let speechWorkerProcess = null
let currentSpeechEngine = null
let isSpeechListening = false
let currentHudMode = 'studio'
let currentVoiceMode = 'dictation'
const pendingUiListResolvers = []
const pendingUiClickResolvers = []
const pendingForegroundInfoResolvers = []

const isWindows = process.platform === 'win32'
const powershell = 'powershell.exe'

function log(message) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'cuesta.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

function getWorkerPath(filename) {
  const unpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'desktop', filename)
  if (fs.existsSync(unpacked)) return unpacked
  return path.join(__dirname, filename)
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send(channel, payload)
  }
}

function createWindow() {
  Menu.setApplicationMenu(null)
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: true,
    backgroundColor: '#0a0a0a',
    title: 'Cuesta — Hands-Free Control Layer',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  log(`createWindow bounds=${JSON.stringify(mainWindow.getBounds())} visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()}`)
  mainWindow.once('ready-to-show', () => {
    log(`ready-to-show visible=${mainWindow.isVisible()}`)
    focusMainWindow()
  })
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      log(`renderer ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`)
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    log(`renderer did-finish-load url=${mainWindow.webContents.getURL()}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${JSON.stringify(details)}`)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) =>
    log(`renderer failed: ${code} ${description} ${url}`)
  )
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
  log(`loading file: ${indexPath} exists=${fs.existsSync(indexPath)}`)
  mainWindow.loadFile(indexPath, { query: { desktop: '1' } })
  mainWindow.on('closed', () => {
    log('mainWindow closed')
    if (hudWindow && !hudWindow.isDestroyed()) hudWindow.close()
    mainWindow = null
  })
}

function createHudWindow() {
  if (hudWindow && !hudWindow.isDestroyed()) return hudWindow
  const display = screen.getPrimaryDisplay()
  const work = display.workArea
  const hudWidth = 516
  const hudHeight = 148
  const startX = Math.round(work.x + (work.width - hudWidth) / 2)
  const startY = Math.round(work.y + 18)

  hudWindow = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x: startX,
    y: startY,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  hudWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { desktop: '1', hud: '1' } })
  hudWindow.on('closed', () => {
    hudWindow = null
  })
  return hudWindow
}

function runPowerShell(script) {
  if (!isWindows) return Promise.resolve({ ok: false, reason: 'Windows actions are available in the Windows desktop build.' })
  return new Promise((resolve) => {
    const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true })
    let output = ''
    let error = ''
    child.stdout.on('data', (data) => { output += data.toString() })
    child.stderr.on('data', (data) => { error += data.toString() })
    child.on('close', (code) => resolve(code === 0 ? { ok: true, output: output.trim() } : { ok: false, reason: error.trim() || 'Windows action failed.' }))
  })
}

function launchApp(appId, customPath) {
  if (!isWindows) return Promise.resolve({ ok: false, reason: 'Windows app launching is available on Windows.' })
  log(`launchApp: ${appId} ${customPath || ''}`)

  const standardApps = {
    'microsoft-edge': 'start msedge:',
    notepad: 'notepad.exe',
    calculator: 'calc.exe',
    vscode: 'code',
    spotify: 'start spotify:',
    downloads: 'explorer.exe shell:Downloads',
    settings: 'start ms-settings:',
  }

  if (appId === 'custom' || customPath) {
    const targetPath = (customPath || appId).trim()
    if (
      targetPath.startsWith('\\\\') ||
      targetPath.startsWith('//') ||
      /[;&|`$<>^"']/.test(targetPath) ||
      !/^[a-zA-Z]:\\[^/:*?"<>|]+\.exe$/i.test(targetPath)
    ) {
      return Promise.resolve({ ok: false, reason: 'Invalid executable path format. Local drive path required (e.g. C:\\...).' })
    }
    if (!fs.existsSync(targetPath)) {
      return Promise.resolve({ ok: false, reason: `Executable not found: ${targetPath}` })
    }
    try {
      const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' })
      child.unref()
      return Promise.resolve({ ok: true, state: 'launched' })
    } catch (err) {
      return Promise.resolve({ ok: false, reason: err.message })
    }
  }

  const targetCmd = standardApps[appId]
  if (!targetCmd) {
    return Promise.resolve({ ok: false, reason: `Unknown or unapproved application: ${appId}` })
  }

  return runPowerShell(targetCmd)
}

function startActionWorker() {
  if (!isWindows) return
  try {
    const scriptPath = getWorkerPath('action-worker.ps1')
    actionWorkerProcess = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true })
    let lineBuffer = ''
    actionWorkerProcess.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8')
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line.startsWith('UI_LIST_B64:')) {
          let parsed = []
          try {
            parsed = JSON.parse(Buffer.from(line.slice(12), 'base64').toString('utf8'))
          } catch {}
          const resolve = pendingUiListResolvers.shift()
          if (resolve) resolve({ ok: true, elements: Array.isArray(parsed) ? parsed : [] })
          continue
        }
        if (line.startsWith('UI_CLICK_B64:')) {
          let parsed = { ok: false, reason: 'Invalid worker reply' }
          try {
            parsed = JSON.parse(Buffer.from(line.slice(13), 'base64').toString('utf8'))
          } catch {}
          const resolve = pendingUiClickResolvers.shift()
          if (resolve) resolve(parsed)
          continue
        }
        if (line.startsWith('FOREGROUND_INFO_B64:')) {
          let parsed = { title: '', processName: '' }
          try {
            parsed = JSON.parse(Buffer.from(line.slice(20), 'base64').toString('utf8'))
          } catch {}
          const resolve = pendingForegroundInfoResolvers.shift()
          if (resolve) resolve({ ok: true, ...parsed })
          continue
        }
        log(`action-worker: ${line}`)
      }
    })
    actionWorkerProcess.stderr.on('data', (d) => log(`action-worker err: ${d.toString().trim()}`))
    actionWorkerProcess.on('close', () => {
      actionWorkerProcess = null
      while (pendingUiListResolvers.length) pendingUiListResolvers.shift()({ ok: false, elements: [] })
      while (pendingUiClickResolvers.length) pendingUiClickResolvers.shift()({ ok: false, reason: 'Worker stopped' })
      while (pendingForegroundInfoResolvers.length) pendingForegroundInfoResolvers.shift()({ ok: false, title: '', processName: '' })
    })
    log('action worker started')
  } catch (err) {
    log(`failed to start action worker: ${err.message}`)
  }
}

function requestUiList() {
  if (!actionWorkerProcess || !actionWorkerProcess.stdin || actionWorkerProcess.killed) {
    return Promise.resolve({ ok: false, elements: [] })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = pendingUiListResolvers.indexOf(done)
      if (idx !== -1) pendingUiListResolvers.splice(idx, 1)
      resolve({ ok: false, elements: [] })
    }, 1800)
    const done = (res) => {
      clearTimeout(timer)
      resolve(res)
    }
    pendingUiListResolvers.push(done)
    actionWorkerProcess.stdin.write('UI_LIST\n')
  })
}

function requestUiClick(targetName) {
  if (!actionWorkerProcess || !actionWorkerProcess.stdin || actionWorkerProcess.killed) {
    return Promise.resolve({ ok: false, reason: 'Action worker offline.' })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = pendingUiClickResolvers.indexOf(done)
      if (idx !== -1) pendingUiClickResolvers.splice(idx, 1)
      resolve({ ok: false, reason: 'UI lookup timed out.' })
    }, 2000)
    const done = (res) => {
      clearTimeout(timer)
      resolve(res)
    }
    pendingUiClickResolvers.push(done)
    const b64 = Buffer.from(String(targetName || ''), 'utf8').toString('base64')
    actionWorkerProcess.stdin.write(`UI_CLICK_B64:${b64}\n`)
  })
}

function requestForegroundInfo() {
  if (!actionWorkerProcess || !actionWorkerProcess.stdin || actionWorkerProcess.killed) {
    return Promise.resolve({ ok: false, title: '', processName: '' })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = pendingForegroundInfoResolvers.indexOf(done)
      if (idx !== -1) pendingForegroundInfoResolvers.splice(idx, 1)
      resolve({ ok: false, title: '', processName: '' })
    }, 1200)
    const done = (res) => {
      clearTimeout(timer)
      resolve(res)
    }
    pendingForegroundInfoResolvers.push(done)
    actionWorkerProcess.stdin.write('FOREGROUND_INFO\n')
  })
}

function sendToWorker(command) {
  if (actionWorkerProcess && actionWorkerProcess.stdin && !actionWorkerProcess.killed) {
    try {
      actionWorkerProcess.stdin.write(command + '\n')
      return Promise.resolve({ ok: true, fast: true })
    } catch (e) {
      log(`worker write error: ${e.message}`)
    }
  }
  return null
}

function startSpeechWorker(provider = 'whisper') {
  if (!isWindows) return
  const isLegacySapi = provider === 'windows-speech'
  const targetEngine = isLegacySapi ? 'windows-speech' : 'whisper'

  if (speechWorkerProcess && currentSpeechEngine === targetEngine && !speechWorkerProcess.killed) {
    return
  }

  if (speechWorkerProcess) {
    try { speechWorkerProcess.stdin.write('QUIT\n') } catch {}
    try { speechWorkerProcess.kill() } catch {}
    speechWorkerProcess = null
  }

  currentSpeechEngine = targetEngine
  try {
    const scriptPath = getWorkerPath(isLegacySapi ? 'speech-worker.ps1' : 'whisper-worker.py')
    if (isLegacySapi) {
      speechWorkerProcess = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true })
    } else {
      const pythonCmd = process.env.PYTHON || 'python'
      speechWorkerProcess = spawn(pythonCmd, ['-u', scriptPath], { windowsHide: true })
    }
    let lineBuffer = ''
    speechWorkerProcess.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8')
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line === 'READY') {
          log(`speech worker ready (${targetEngine})`)
          setSpeechWorkerMode(currentVoiceMode)
          continue
        }
        if (line === 'STATUS:listening') {
          isSpeechListening = true
          broadcast('cuesta:dictation:status', { state: 'listening', text: 'Listening… speak now.' })
          continue
        }
        if (line === 'STATUS:off') {
          isSpeechListening = false
          broadcast('cuesta:dictation:status', { state: 'off', text: '' })
          continue
        }
        if (line.startsWith('LEVEL:')) {
          const level = parseInt(line.slice(6), 10) || 0
          broadcast('cuesta:dictation:status', { state: 'listening', text: '', volume: level, isVolumeOnly: true })
          continue
        }
        if (line.startsWith('INTERIM_B64:')) {
          const spoken = Buffer.from(line.slice(12), 'base64').toString('utf8')
          broadcast('cuesta:dictation:status', { state: 'listening', text: spoken, isInterim: true })
          continue
        }
        if (line.startsWith('CMD_B64:')) {
          const spoken = Buffer.from(line.slice(8), 'base64').toString('utf8').trim()
          if (spoken) {
            broadcast('cuesta:dictation:status', {
              state: isSpeechListening ? 'listening' : 'done',
              text: spoken,
              rawText: spoken,
              isFinal: true,
              isCommand: true,
            })
          }
          continue
        }
        if (line.startsWith('FINAL_B64:')) {
          const spoken = Buffer.from(line.slice(10), 'base64').toString('utf8').trim()
          if (spoken) {
            broadcast('cuesta:dictation:status', {
              state: isSpeechListening ? 'listening' : 'done',
              text: spoken,
              rawText: spoken,
              isFinal: true,
              isCommand: false,
            })
          }
          continue
        }
        if (line.startsWith('ERR_B64:')) {
          const errMsg = Buffer.from(line.slice(8), 'base64').toString('utf8')
          isSpeechListening = false
          log(`speech worker err: ${errMsg}`)
          broadcast('cuesta:dictation:status', { state: 'error', text: errMsg })
        }
      }
    })
    speechWorkerProcess.stderr.on('data', (d) => log(`speech-worker stderr: ${d.toString().trim()}`))
    speechWorkerProcess.on('error', (err) => {
      log(`speech-worker process error: ${err.message}`)
      broadcast('cuesta:dictation:status', {
        state: 'error',
        text: `Speech worker error (${targetEngine}): ${err.message}. Ensure Python 3.x is installed.`
      })
    })
    speechWorkerProcess.on('close', () => {
      isSpeechListening = false
      speechWorkerProcess = null
      currentSpeechEngine = null
    })
    log(`speech worker process spawned (${targetEngine})`)
  } catch (err) {
    log(`failed to start speech worker: ${err.message}`)
  }
}

function setSpeechWorkerMode(mode) {
  currentVoiceMode = mode === 'control' ? 'control' : 'dictation'
  if (speechWorkerProcess && speechWorkerProcess.stdin && !speechWorkerProcess.killed) {
    try {
      speechWorkerProcess.stdin.write(currentVoiceMode === 'control' ? 'MODE:CONTROL\n' : 'MODE:DICTATION\n')
    } catch {}
  }
}

function toggleDictation(provider) {
  const activeProvider = provider || currentSpeechEngine || 'whisper'
  if (!isWindows) return Promise.resolve({ ok: false, reason: 'Dictation is available in the Windows desktop build.' })
  if (activeProvider === 'windows-voice-typing') {
    return sendToWorker('VOICE_TYPING') || Promise.resolve({ ok: false, reason: 'Action worker offline.' })
  }
  const targetEngine = activeProvider === 'windows-speech' ? 'windows-speech' : 'whisper'
  if (!speechWorkerProcess || !speechWorkerProcess.stdin || speechWorkerProcess.killed || currentSpeechEngine !== targetEngine) {
    startSpeechWorker(targetEngine)
    return Promise.resolve({
      ok: false,
      reason: targetEngine === 'whisper' ? 'Starting Whisper neural model — speak in ~2 seconds.' : 'Starting speech engine…'
    })
  }
  try {
    if (isSpeechListening) {
      speechWorkerProcess.stdin.write('STOP\n')
      return Promise.resolve({ ok: true, state: 'off' })
    }
    setSpeechWorkerMode(currentVoiceMode)
    speechWorkerProcess.stdin.write('START\n')
    return Promise.resolve({ ok: true, state: 'listening' })
  } catch (err) {
    return Promise.resolve({ ok: false, reason: err.message })
  }
}

function pasteExternalText(text) {
  if (!isWindows || !text) return Promise.resolve({ ok: false })
  let prevClipboard = ''
  try { prevClipboard = clipboard.readText() } catch {}
  clipboard.writeText(text)
  const res =
    sendToWorker('PASTE') ||
    runPowerShell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')")
  // Preserve prior user clipboard once target window has processed Ctrl+V
  setTimeout(() => {
    try {
      if (clipboard.readText() === text) {
        clipboard.writeText(prevClipboard || '')
      }
    } catch {}
  }, 240)
  return res
}

function runDeviceCommand(command) {
  const map = {
    'switch-window': 'SWITCH_WINDOW',
    'close-window': 'CLOSE_WINDOW',
    'minimize-window': 'MINIMIZE_WINDOW',
    'maximize-window': 'MAXIMIZE_WINDOW',
    'snap-left': 'SNAP_LEFT',
    'snap-right': 'SNAP_RIGHT',
    'show-desktop': 'SHOW_DESKTOP',
    'scroll-left': 'SCROLL_LEFT',
    'scroll-right': 'SCROLL_RIGHT',
    'zoom-in': 'ZOOM_IN',
    'zoom-out': 'ZOOM_OUT',
    'volume-up': 'VOL_UP',
    'volume-down': 'VOL_DOWN',
    'volume-mute': 'VOL_MUTE',
    undo: 'UNDO',
    copy: 'COPY',
    paste: 'PASTE',
    escape: 'ESCAPE',
  }
  const workerCmd = map[command]
  if (!workerCmd) return Promise.resolve({ ok: false, reason: `Unsupported device command: ${command}` })
  return sendToWorker(workerCmd) || Promise.resolve({ ok: false, reason: 'Action worker offline.' })
}

const OLLAMA_BASE = 'http://127.0.0.1:11434'

async function getOllamaStatus() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1000) })
    if (!res.ok) return { available: false, models: [] }
    const data = await res.json()
    const models = Array.isArray(data?.models) ? data.models.map((m) => m.name).filter(Boolean) : []
    const preferred = models.find((n) => n.startsWith('qwen2.5:3b')) || models.find((n) => n.startsWith('llama3.1')) || models[0]
    return { available: models.length > 0, models, selectedModel: preferred }
  } catch {
    return { available: false, models: [] }
  }
}

async function cleanTranscriptWithAi(text, model) {
  if (!text) return null
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1800),
      body: JSON.stringify({
        model: model || 'qwen2.5:3b',
        stream: false,
        options: { temperature: 0.1, num_predict: 120 },
        prompt:
          'Clean only spelling, casing, and punctuation of this raw speech transcript. Do NOT answer it, do NOT add new ideas, and output ONLY the cleaned text:\n\n' +
          text,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const out = String(data?.response || '').trim()
    return out || null
  } catch {
    return null
  }
}

async function parseControlIntentWithAi(phrase, model, appNames) {
  if (!phrase) return null
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1800),
      body: JSON.stringify({
        model: model || 'qwen2.5:3b',
        stream: false,
        format: 'json',
        options: { temperature: 0.0, num_predict: 90 },
        prompt: `Map this Windows accessibility voice command to strict JSON. Return null JSON {} if unclear.
Valid outputs:
1) {"type":"device-cmd","command":"switch-window|close-window|minimize-window|maximize-window|snap-left|snap-right|show-desktop|scroll-left|scroll-right|zoom-in|zoom-out|volume-up|volume-down|volume-mute|undo|copy|paste|escape","label":"short label"}
2) {"type":"click-element","targetName":"button text on screen"}
3) {"type":"action","action":"click|double-click|right-click|scroll-down|scroll-up|next|previous|back|select|toggle-pointer|recenter-pointer|pause-gestures|dictation"}
4) {"type":"open-app","appId":"id","appName":"name"} (ONLY if explicitly asking to open/launch one of: ${(appNames || []).join(', ')})
Utterance: "${phrase}"`,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const parsed = JSON.parse(String(data?.response || '{}').trim())
    return parsed && parsed.type ? parsed : null
  } catch {
    return null
  }
}

function nativeAction(action, key, targetAppId) {
  if (action === 'launch-app') {
    return launchApp(targetAppId || key)
  }

  const workerMap = {
    click: 'CLICK',
    'double-click': 'DOUBLE_CLICK',
    'right-click': 'RIGHT_CLICK',
    select: 'SELECT',
    next: 'NEXT',
    previous: 'PREV',
    back: 'BACK',
    'scroll-down': 'SCROLL_DOWN',
    'scroll-up': 'SCROLL_UP',
  }

  if (action === 'dictation') return toggleDictation()

  if (action === 'key') {
    const k = String(key || 'ENTER').replaceAll("'", "''")
    const workerFast = sendToWorker(`KEY:${k}`)
    if (workerFast) return workerFast
    return runPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k}')`)
  }

  const cmd = workerMap[action]
  if (cmd) {
    const workerFast = sendToWorker(cmd)
    if (workerFast) return workerFast
  }

  const fallbackMap = {
    select: '{ENTER}',
    next: '{TAB}',
    previous: '+{TAB}',
    back: '%{LEFT}',
    'scroll-down': '{PGDN}',
    'scroll-up': '{PGUP}',
  }

  const sendKey = fallbackMap[action]
  if (!sendKey) return Promise.resolve({ ok: false, reason: `Unsupported Windows action: ${action}` })
  return runPowerShell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`)
}

function startKeyboardHook() {
  const scriptPath = getWorkerPath('keyboard-hook.ps1')
  chordProcess = spawn(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true })
  let output = ''
  chordProcess.stdout.on('data', (data) => {
    output += data.toString()
    if (output.includes('CUESTA_CTRL_WIN')) {
      output = output.replace('CUESTA_CTRL_WIN', '')
      void toggleDictation()
    }
    if (output.includes('CUESTA_SHIFT_WIN')) {
      output = output.replace('CUESTA_SHIFT_WIN', '')
      const nextMode = currentHudMode === 'hud' ? 'studio' : 'hud'
      setWindowMode(nextMode)
    }
  })
  chordProcess.stderr.on('data', (data) => log(`Keyboard hook: ${data.toString().trim()}`))
  chordProcess.on('error', (error) => {
    log(`Keyboard hook failed: ${error.stack || error.message}`)
  })
  log('global Ctrl+Win & Shift+Win hooks started')
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false }
  currentHudMode = mode === 'hud' ? 'hud' : 'studio'
  if (currentHudMode === 'hud') {
    const hud = createHudWindow()
    mainWindow.hide()
    hud.showInactive()
  } else {
    if (hudWindow && !hudWindow.isDestroyed()) hudWindow.hide()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  mainWindow.webContents.send('cuesta:window:mode-changed', currentHudMode)
  return { ok: true, mode: currentHudMode }
}

async function pickCustomExe() {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select an Application Executable',
    filters: [{ name: 'Executable files (*.exe)', extensions: ['exe'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
}

app.whenReady().then(() => {
  log(`starting Cuesta ${process.platform} ${process.arch}`)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL()
    const isTrusted = url.startsWith('file:') || url.startsWith('http://localhost')
    callback(isTrusted && permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const url = webContents.getURL()
    const isTrusted = url.startsWith('file:') || url.startsWith('http://localhost')
    return isTrusted && permission === 'media'
  })

  createWindow()
  createHudWindow()

  ipcMain.handle('cuesta:action', (_event, payload) => nativeAction(payload.action, payload.key, payload.targetAppId))
  ipcMain.handle('cuesta:device-cmd', (_event, payload) => runDeviceCommand(payload?.command))
  ipcMain.handle('cuesta:dictation:toggle', (_event, payload) => toggleDictation(payload?.provider))
  ipcMain.on('cuesta:dictation:mode', (_event, payload) => setSpeechWorkerMode(payload?.mode))
  ipcMain.handle('cuesta:clipboard:paste-text', (_event, payload) => pasteExternalText(payload?.text))
  ipcMain.handle('cuesta:app:launch', (_event, payload) => launchApp(payload.appId, payload.customPath))
  ipcMain.handle('cuesta:app:pick-exe', () => pickCustomExe())
  ipcMain.handle('cuesta:ui:elements', () => requestUiList())
  ipcMain.handle('cuesta:ui:click-name', (_event, payload) => requestUiClick(payload?.targetName))
  ipcMain.handle('cuesta:foreground:info', () => requestForegroundInfo())
  ipcMain.handle('cuesta:ollama:status', () => getOllamaStatus())
  ipcMain.handle('cuesta:ollama:clean-text', (_event, payload) => cleanTranscriptWithAi(payload?.text, payload?.model))
  ipcMain.handle('cuesta:ollama:parse-intent', (_event, payload) =>
    parseControlIntentWithAi(payload?.phrase, payload?.model, payload?.appNames)
  )
  ipcMain.handle('cuesta:window:mode', (_event, mode) => setWindowMode(mode))
  ipcMain.handle('cuesta:cursor:click', (_event, payload) => {
    const kind = payload?.kind || 'click'
    const map = { click: 'CLICK', 'double-click': 'DOUBLE_CLICK', 'right-click': 'RIGHT_CLICK' }
    return sendToWorker(map[kind] || 'CLICK') || Promise.resolve({ ok: false })
  })

  ipcMain.on('cuesta:cursor:move-norm', (_event, { nx, ny }) => {
    if (actionWorkerProcess && actionWorkerProcess.stdin && !actionWorkerProcess.killed) {
      try {
        actionWorkerProcess.stdin.write(`MOVE_NORM:${Number(nx).toFixed(4)},${Number(ny).toFixed(4)}\n`)
      } catch {}
    }
  })
  ipcMain.on('cuesta:cursor:move', (_event, { x, y }) => {
    if (actionWorkerProcess && actionWorkerProcess.stdin && !actionWorkerProcess.killed) {
      try {
        actionWorkerProcess.stdin.write(`MOVE_CURSOR:${Math.round(x)},${Math.round(y)}\n`)
      } catch {}
    }
  })

  ipcMain.on('cuesta:hud:state', (_event, snapshot) => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.webContents.send('cuesta:hud:state', snapshot)
    }
  })
  ipcMain.on('cuesta:hud:command', (_event, command) => {
    if (command === 'expand-studio') {
      setWindowMode('studio')
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cuesta:hud:command', command)
    }
  })
  ipcMain.on('cuesta:hud:move-by', (_event, { dx, dy }) => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      const [cx, cy] = hudWindow.getPosition()
      hudWindow.setPosition(Math.round(cx + dx), Math.round(cy + dy))
    }
  })

  try {
    globalShortcut.register('Alt+C', () => {
      mainWindow?.webContents.send('cuesta:hotkey', { chord: 'Alt+C' })
    })
    globalShortcut.register('Alt+P', () => {
      mainWindow?.webContents.send('cuesta:hotkey', { chord: 'Alt+P' })
    })
  } catch (e) {
    log(`Global shortcut registration skipped: ${e.message}`)
  }

  if (isWindows) {
    startKeyboardHook()
    startActionWorker()
    startSpeechWorker()
  }
  app.on('activate', () => mainWindow?.show())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (speechWorkerProcess) {
    try { speechWorkerProcess.stdin.write('QUIT\n') } catch {}
    speechWorkerProcess.kill()
  }
  if (actionWorkerProcess) {
    try { actionWorkerProcess.stdin.write('QUIT\n') } catch {}
    actionWorkerProcess.kill()
  }
  if (chordProcess) chordProcess.kill()
})

process.on('uncaughtException', (error) => {
  log(`uncaught exception: ${error.stack || error.message}`)
  dialog.showErrorBox('Cuesta notice', `${error.message}\n\nA log was saved in the Cuesta user-data folder.`)
})
