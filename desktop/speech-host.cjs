const { spawn } = require('child_process')

// Resolved once per launch so the worker and the status probe agree.
const DEFAULT_WHISPER_MODEL = process.env.CUESTA_WHISPER_MODEL || 'small.en'
const DEFAULT_WHISPER_LANGUAGE = process.env.CUESTA_WHISPER_LANGUAGE || 'en'

/**
 * Owns the resident speech worker lifecycle: Whisper first, Windows Speech as
 * the automatic fallback. Exposes status so the renderer can explain what is
 * actually running instead of guessing.
 */
function createSpeechHost({ isWindows, powershell, getWorkerPath, broadcast, log, sendToWorker }) {
  let speechWorkerProcess = null
  let currentSpeechEngine = null
  let isSpeechListening = false
  let speechReady = false
  let speechWorkerReplacing = false
  let pendingSpeechStart = false
  let speechFallbackAttempted = false
  let speechFallbackReason = ''
  let speechProbeCache = null
  let currentVoiceMode = 'dictation'
  let speechStatus = {
    engine: 'whisper',
    state: 'idle',
    model: DEFAULT_WHISPER_MODEL,
    language: DEFAULT_WHISPER_LANGUAGE,
    fallback: false,
    detail: '',
  }

function setSpeechStatus(patch) {
  speechStatus = { ...speechStatus, ...patch }
  broadcast('cuesta:speech:status', speechStatus)
}

/**
 * Resolve a usable Python 3 interpreter. Windows installs vary between `python`,
 * `python3` and the `py` launcher, so try each in order before giving up.
 */
function spawnPythonWorker(args, onSpawned, onFailed) {
  const candidates = [...new Set([process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean))]
  let index = 0

  const attempt = () => {
    if (index >= candidates.length) {
      onFailed(new Error('Python 3 was not found on PATH. Install Python 3.10+ and run `npm run speech:setup`.'))
      return
    }
    const command = candidates[index++]
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (err) {
      attempt()
      return
    }
    let spawned = false
    child.once('spawn', () => {
      if (spawned) return
      spawned = true
      onSpawned(child, command)
    })
    child.once('error', (err) => {
      if (spawned) return
      if (err.code === 'ENOENT') {
        attempt()
        return
      }
      onFailed(err)
    })
  }

  attempt()
}

function fallbackToWindowsSpeech(reason) {
  if (speechFallbackAttempted) {
    setSpeechStatus({ state: 'error', detail: reason })
    broadcast('cuesta:dictation:status', { state: 'error', text: reason })
    return
  }
  speechFallbackAttempted = true
  speechFallbackReason = reason
  const shouldStart = pendingSpeechStart || isSpeechListening
  log(`whisper unavailable, falling back to Windows Speech: ${reason}`)
  isSpeechListening = false
  startSpeechWorker('windows-speech', shouldStart)
  setSpeechStatus({
    fallback: true,
    detail: `Windows Speech is active. Whisper unavailable: ${reason}`,
  })
}

function startSpeechWorker(provider = 'whisper', autoStart = false) {
  if (!isWindows) return
  const isLegacySapi = provider === 'windows-speech'
  const targetEngine = isLegacySapi ? 'windows-speech' : 'whisper'

  if (speechWorkerProcess && currentSpeechEngine === targetEngine && !speechWorkerProcess.killed) {
    pendingSpeechStart = pendingSpeechStart || Boolean(autoStart)
    return
  }

  if (speechWorkerProcess) {
    speechWorkerReplacing = true
    try { speechWorkerProcess.stdin.write('QUIT\n') } catch {}
    try { speechWorkerProcess.kill() } catch {}
    speechWorkerProcess = null
  }

  currentSpeechEngine = targetEngine
  speechReady = false
  pendingSpeechStart = Boolean(autoStart)
  setSpeechStatus({
    engine: targetEngine,
    state: 'loading',
    fallback: targetEngine === 'windows-speech' && speechFallbackAttempted,
    detail:
      targetEngine === 'whisper'
        ? `Loading Whisper ${DEFAULT_WHISPER_MODEL} (first run downloads the model)…`
        : 'Starting the built-in Windows Speech engine…',
  })

  const scriptPath = getWorkerPath(isLegacySapi ? 'speech-worker.ps1' : 'whisper-worker.py')

  const wireWorker = (child) => {
    speechWorkerProcess = child
    speechWorkerReplacing = false
    let lineBuffer = ''

    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8')
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line === 'READY') {
          speechReady = true
          log(`speech worker ready (${targetEngine})`)
          setSpeechStatus({
            state: 'ready',
            detail:
              targetEngine === 'whisper'
                ? `${DEFAULT_WHISPER_MODEL} model ready`
                : speechFallbackAttempted
                ? `Windows Speech ready. Neural engine unavailable: ${speechFallbackReason}`
                : 'Windows Speech ready',
          })
          setSpeechWorkerMode(currentVoiceMode)
          if (pendingSpeechStart && child.stdin && !child.killed) {
            pendingSpeechStart = false
            try { child.stdin.write('START\n') } catch {}
          }
          continue
        }
        if (line === 'STATUS:listening') {
          speechReady = true
          isSpeechListening = true
          setSpeechStatus({ state: 'listening' })
          broadcast('cuesta:dictation:status', { state: 'listening', text: 'Listening… speak now.' })
          continue
        }
        if (line === 'STATUS:off') {
          isSpeechListening = false
          setSpeechStatus({ state: speechReady ? 'ready' : 'idle' })
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
          log(`speech worker err (${targetEngine}): ${errMsg}`)
          if (targetEngine === 'whisper') {
            fallbackToWindowsSpeech(errMsg)
          } else {
            setSpeechStatus({ state: 'error', detail: errMsg })
            broadcast('cuesta:dictation:status', { state: 'error', text: errMsg })
          }
        }
      }
    })

    child.stderr.on('data', (d) => log(`speech-worker stderr: ${d.toString().trim()}`))

    child.on('error', (err) => {
      if (speechWorkerProcess !== child) return
      log(`speech-worker process error (${targetEngine}): ${err.message}`)
      if (targetEngine === 'whisper') {
        fallbackToWindowsSpeech(err.message)
      } else {
        setSpeechStatus({ state: 'error', detail: err.message })
        broadcast('cuesta:dictation:status', { state: 'error', text: `Windows Speech failed: ${err.message}` })
      }
    })

    child.on('close', (code) => {
      // Ignore exits from a worker that has already been replaced.
      if (speechWorkerProcess !== child) return
      speechWorkerProcess = null
      currentSpeechEngine = null
      const replacing = speechWorkerReplacing
      speechWorkerReplacing = false
      speechReady = false
      pendingSpeechStart = false
      if (isSpeechListening) {
        isSpeechListening = false
        broadcast('cuesta:dictation:status', { state: 'off', text: '' })
      }
      if (replacing) return
      if (targetEngine === 'whisper' && !speechFallbackAttempted) {
        fallbackToWindowsSpeech(
          code ? `Whisper worker exited with code ${code}.` : 'Whisper worker stopped before it was ready.'
        )
      } else {
        setSpeechStatus({
          state: 'idle',
          detail: targetEngine === 'whisper' ? 'Whisper worker stopped.' : 'Windows Speech worker stopped.',
        })
      }
    })

    log(`speech worker process spawned (${targetEngine})`)
  }

  if (isLegacySapi) {
    const child = spawn(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true })
    wireWorker(child)
    return
  }

  spawnPythonWorker(
    ['-u', scriptPath],
    (child) => wireWorker(child),
    (error) => fallbackToWindowsSpeech(error.message)
  )
}

function setSpeechWorkerMode(mode) {
  currentVoiceMode = mode === 'control' ? 'control' : 'dictation'
  if (speechWorkerProcess && speechWorkerProcess.stdin && !speechWorkerProcess.killed) {
    try {
      speechWorkerProcess.stdin.write(currentVoiceMode === 'control' ? 'MODE:CONTROL\n' : 'MODE:DICTATION\n')
    } catch {}
  }
}

function probePythonSpeechRuntime(force = false) {
  const now = Date.now()
  if (!force && speechProbeCache && now - speechProbeCache.at < 60000) {
    return Promise.resolve(speechProbeCache)
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      speechProbeCache = { at: Date.now(), ...payload }
      resolve(speechProbeCache)
    }

    spawnPythonWorker(
      ['-c', 'import faster_whisper, sounddevice, numpy; print("ok")'],
      (child) => {
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          try { child.kill() } catch {}
          finish({ python: child.spawnfile || 'python', depsReady: false, detail: 'Dependency check timed out.' })
        }, 10000)

        child.stdout.on('data', (d) => { out += d.toString('utf8') })
        child.stderr.on('data', (d) => { err += d.toString('utf8') })
        child.on('error', () => {
          clearTimeout(timer)
          finish({ python: child.spawnfile || 'python', depsReady: false, detail: 'Python could not be started.' })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          const ok = code === 0 && /\bok\b/i.test(out)
          const lastErr = err.trim().split(/\r?\n/).pop() || ''
          finish({
            python: child.spawnfile || 'python',
            depsReady: ok,
            detail: ok
              ? 'Python speech dependencies are installed.'
              : lastErr || 'faster-whisper or sounddevice could not be imported.',
          })
        })
      },
      (error) => finish({ python: null, depsReady: false, detail: error.message })
    )
  })
}

function toggleDictation(provider) {
  const activeProvider = provider || currentSpeechEngine || 'whisper'
  if (!isWindows) return Promise.resolve({ ok: false, reason: 'Dictation is available in the Windows desktop build.' })
  if (activeProvider === 'windows-voice-typing') {
    return sendToWorker('VOICE_TYPING') || Promise.resolve({ ok: false, reason: 'Action worker offline.' })
  }

  let targetEngine = activeProvider === 'windows-speech' ? 'windows-speech' : 'whisper'
  // Once Whisper has been ruled out for this session, stay on the working fallback.
  if (targetEngine === 'whisper' && speechFallbackAttempted) targetEngine = 'windows-speech'

  if (!speechWorkerProcess || !speechWorkerProcess.stdin || speechWorkerProcess.killed || currentSpeechEngine !== targetEngine) {
    startSpeechWorker(targetEngine, true)
    return Promise.resolve({ ok: true, state: 'starting' })
  }

  if (!speechReady) {
    pendingSpeechStart = true
    return Promise.resolve({ ok: true, state: 'starting' })
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

function restartSpeechEngine() {
  if (!isWindows) return { ok: false, reason: 'Dictation is available in the Windows desktop build.' }
  speechFallbackAttempted = false
  speechProbeCache = null
  const shouldStart = isSpeechListening
  if (speechWorkerProcess) {
    speechWorkerReplacing = true
    try { speechWorkerProcess.stdin.write('QUIT\n') } catch {}
    try { speechWorkerProcess.kill() } catch {}
    speechWorkerProcess = null
  }
  currentSpeechEngine = null
  startSpeechWorker('whisper', shouldStart)
  return { ok: true }
}

  return {
    start: (provider = 'whisper', autoStart = false) => startSpeechWorker(provider, autoStart),
    toggle: (provider) => toggleDictation(provider),
    setMode: (mode) => setSpeechWorkerMode(mode),
    restart: () => restartSpeechEngine(),
    getEngine: () => currentSpeechEngine,
    isListening: () => isSpeechListening,
    status: async (force = false) => {
      const probe = await probePythonSpeechRuntime(force)
      return {
        ...speechStatus,
        model: DEFAULT_WHISPER_MODEL,
        language: DEFAULT_WHISPER_LANGUAGE,
        python: probe.python,
        depsReady: probe.depsReady,
        probeDetail: probe.detail,
        listening: isSpeechListening,
      }
    },
    shutdown: () => {
      if (!speechWorkerProcess) return
      speechWorkerReplacing = true
      try { speechWorkerProcess.stdin.write('QUIT\n') } catch {}
      try { speechWorkerProcess.kill() } catch {}
      speechWorkerProcess = null
    },
  }
}

module.exports = { createSpeechHost, DEFAULT_WHISPER_MODEL, DEFAULT_WHISPER_LANGUAGE }
