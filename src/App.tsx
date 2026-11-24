import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ActionKind, HeadPointerConfig, HudStateSnapshot, Page, Settings, SwitchProfile, VoiceMode } from './lib/types'
import {
  averageVectors,
  computeFeatureWeights,
  computeMatchScore,
  MultiSwitchDetector,
} from './lib/signal'
import { FingerSnapDetector } from './lib/snap-detector'
import { HeadPointerEngine } from './lib/head-pointer'
import {
  desktopAvailable,
  launchDesktopApp,
  sendCursorClick,
  sendCursorNorm,
  sendDesktopAction,
  setDesktopWindowMode,
} from './lib/desktop'
import { dictationService } from './lib/dictation'
import {
  demoProfile,
  exportProfiles,
  importProfiles,
  loadProfiles,
  loadSettings,
  saveProfiles,
  saveSettings,
} from './lib/storage'
import { requestCameraStream, simulatedFeatureFrame, stopCameraStream } from './lib/vision'
import { LocalFaceTracker } from './lib/face-tracker'
import { useSwitchTraining } from './lib/use-switch-training'

import { Sidebar } from './components/Sidebar'
import { HudTopBar } from './components/HudTopBar'
import { CompactHudView } from './components/CompactHudView'
import { VirtualCursorOverlay } from './components/VirtualCursorOverlay'
import { StudioPage } from './pages/StudioPage'
import { SandboxPage } from './pages/SandboxPage'
import { SettingsPage } from './pages/SettingsPage'

function clickDomElementAt(clientX: number, clientY: number): boolean {
  const raw = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  if (!raw) return false
  const target = (raw.closest(
    'button, a, input, textarea, select, label, [role="button"], .scan-target-card, .chip'
  ) ?? raw) as HTMLElement
  if (target && typeof target.click === 'function') {
    if (typeof target.focus === 'function') target.focus()
    target.click()
    return true
  }
  return false
}

export default function App() {
  const search = useMemo(() => new URLSearchParams(window.location.search), [])
  const isHudWindow = useMemo(() => search.has('hud'), [search])
  const demoMode = useMemo(() => search.has('demo'), [search])

  // Dedicated Transparent Floating HUD Window Renderer (Electron Window #2)
  if (isHudWindow) {
    return <StandaloneHudApp />
  }

  return <StudioApp initialDemoMode={demoMode} />
}

function StandaloneHudApp() {
  const [snapshot, setSnapshot] = useState<HudStateSnapshot>({
    cameraReady: false,
    visionReady: false,
    pointerEnabled: false,
    dwellClick: false,
    dwellProgress: 0,
    armedCount: 0,
    activeLabel: 'Standby',
    liveScore: 0,
    threshold: 0.54,
    dictation: { state: 'off', text: '', volume: 0 },
    notice: '',
    gesturesPaused: false,
    voiceMode: 'dictation',
    aiReady: false,
  })

  useEffect(() => {
    document.documentElement.classList.add('hud-window-mode')
    const unsubHud = window.cuestaDesktop?.onHudState((next) => setSnapshot(next))
    const unsubDict = window.cuestaDesktop?.onDictationStatus((d) => {
      setSnapshot((prev) => ({
        ...prev,
        dictation: d.isVolumeOnly
          ? { ...prev.dictation, state: 'listening', volume: d.volume ?? 0 }
          : {
              state: d.state,
              text: d.text || prev.dictation.text,
              isInterim: d.isInterim,
              volume: d.volume ?? prev.dictation.volume,
              engine: prev.dictation.engine,
            },
      }))
    })
    return () => {
      document.documentElement.classList.remove('hud-window-mode')
      unsubHud?.()
      unsubDict?.()
    }
  }, [])

  return (
    <div className="compact-hud-root is-standalone">
      <CompactHudView
        activeProfile={null}
        activeLabel={snapshot.activeLabel}
        liveScore={snapshot.liveScore}
        threshold={snapshot.threshold}
        cameraReady={snapshot.cameraReady}
        pointerEnabled={snapshot.pointerEnabled}
        gesturesPaused={snapshot.gesturesPaused}
        voiceMode={snapshot.voiceMode}
        dictationState={snapshot.dictation}
        armedCount={snapshot.armedCount}
        notice={snapshot.notice}
        isSeparateWindow
        onExpandStudio={() => window.cuestaDesktop?.sendHudCommand('expand-studio')}
        onToggleDictation={() => window.cuestaDesktop?.sendHudCommand('toggle-dictation')}
        onToggleVoiceMode={() => window.cuestaDesktop?.sendHudCommand('toggle-voice-mode')}
        onTogglePause={() => window.cuestaDesktop?.sendHudCommand('toggle-pause')}
        onTogglePointer={() => window.cuestaDesktop?.sendHudCommand('toggle-pointer')}
        onRecenterPointer={() => window.cuestaDesktop?.sendHudCommand('recenter-pointer')}
        onTriggerActive={() => window.cuestaDesktop?.sendHudCommand('trigger-active')}
      />
    </div>
  )
}

function StudioApp({ initialDemoMode }: { initialDemoMode: boolean }) {
  const [page, setPage] = useState<Page>(() => {
    const pathname = window.location.pathname.replace(/^\//, '')
    if (pathname === 'sandbox' || pathname === 'settings') return pathname as Page
    return 'studio'
  })

  const [hudMode, setHudMode] = useState<'studio' | 'hud'>('studio')
  const [profiles, setProfiles] = useState<SwitchProfile[]>(() => loadProfiles(initialDemoMode))
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null,
    [profiles, settings.activeProfileId]
  )
  const [multiScores, setMultiScores] = useState<Record<string, number>>({})
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({})
  const armedCount = useMemo(() => profiles.filter((p) => p.enabled !== false).length, [profiles])
  const [notice, setNotice] = useState('')

  const [dictationState, setDictationState] = useState<{
    state: string
    text: string
    isInterim?: boolean
    volume?: number
    engine?: string
  }>({ state: 'off', text: '', volume: 0, engine: 'whisper' })

  const [sensorMode, setSensorMode] = useState<'camera' | 'demo'>(initialDemoMode ? 'demo' : 'camera')
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'ready' | 'blocked'>('idle')
  const [visionState, setVisionState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [liveScore, setLiveScore] = useState(0)
  const [verifyScore, setVerifyScore] = useState(0)

  const [cursorUi, setCursorUi] = useState({ nx: 0.5, ny: 0.5, dwellProgress: 0 })
  const [cursorJustClicked, setCursorJustClicked] = useState(false)
  const [aiReady, setAiReady] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackerRef = useRef<LocalFaceTracker | null>(null)
  const snapDetectorRef = useRef<FingerSnapDetector | null>(null)
  const latestFeaturesRef = useRef<number[] | null>(null)
  const multiDetectorRef = useRef<MultiSwitchDetector>(new MultiSwitchDetector(profiles))
  const headPointerRef = useRef<HeadPointerEngine>(new HeadPointerEngine())
  const lastCursorUiSyncRef = useRef(0)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles

  const training = useSwitchTraining({
    sensorMode,
    latestFeaturesRef,
    onNotice: showNotice,
    onSaveProfile: (profile) => {
      setProfiles((curr) => [profile, ...curr.filter((p) => !p.demo)])
      setSettings((curr) => ({ ...curr, activeProfileId: profile.id }))
    },
  })
  const trainingRef = useRef(training)
  trainingRef.current = training

  const triggerActionRef = useRef<(action: ActionKind, mappedKey?: string, targetApp?: string, source?: string) => void>(
    () => undefined
  )

  useEffect(() => {
    saveProfiles(profiles)
    multiDetectorRef.current.setProfiles(profiles)
  }, [profiles])

  useEffect(() => {
    saveSettings(settings)
    dictationService.setProvider(settings.speechProvider)
    dictationService.setVoiceMode(settings.voiceMode)
    dictationService.setAiConfig(settings.ollamaEnabled, settings.ollamaModel)
  }, [settings])

  useEffect(() => {
    if (!desktopAvailable()) return
    window.cuestaDesktop
      ?.getSpeechStatus?.()
      .then((status) => {
        dictationService.handleEngineStatus(status)
        setDictationState((prev) => ({ ...prev, engine: status.engine }))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!desktopAvailable()) return
    const checkOllama = () => {
      window.cuestaDesktop
        ?.getOllamaStatus?.()
        .then((res) => {
          setAiReady(Boolean(res?.available))
          if (res?.available && res.selectedModel && !settingsRef.current.ollamaModel) {
            setSettings((curr) => ({ ...curr, ollamaModel: res.selectedModel || 'qwen2.5:3b' }))
          }
        })
        .catch(() => setAiReady(false))
    }
    checkOllama()
    const timer = window.setInterval(checkOllama, 20000)
    return () => window.clearInterval(timer)
  }, [])

  // Runtime acoustic Finger Snap detector when any armed switch uses 'finger-snap'
  const hasArmedSnapSwitch = useMemo(
    () => profiles.some((p) => p.enabled !== false && p.signal === 'finger-snap'),
    [profiles]
  )
  useEffect(() => {
    if (!hasArmedSnapSwitch && !settings.fingerSnapEnabled) {
      snapDetectorRef.current?.stop()
      snapDetectorRef.current = null
      return
    }
    if (training.signalKind === 'finger-snap' && (training.step === 'signal' || training.step === 'verify')) {
      snapDetectorRef.current?.stop()
      snapDetectorRef.current = null
      return
    }
    const detector = new FingerSnapDetector()
    snapDetectorRef.current = detector
    const unsub = detector.subscribe(() => {
      const paused = settingsRef.current.gesturesPaused
      const snapProfiles = profilesRef.current.filter(
        (p) => p.enabled !== false && p.signal === 'finger-snap'
      )
      for (const p of snapProfiles) {
        if (!paused || p.action === 'pause-gestures') {
          triggerActionRef.current(p.action, p.key, p.targetAppId, 'switch')
          showNotice(`Snap fired: ${p.name}`)
        }
      }
    })
    void detector.start()
    return () => {
      unsub()
      detector.stop()
      if (snapDetectorRef.current === detector) snapDetectorRef.current = null
    }
  }, [hasArmedSnapSwitch, settings.fingerSnapEnabled, training.signalKind, training.step])

  useEffect(() => {
    dictationService.setActionHandler((action) => triggerActionRef.current(action, undefined, undefined, 'voice'))
    dictationService.setVoiceModeHandler((mode) => {
      setSettings((curr) => ({ ...curr, voiceMode: mode }))
      showNotice(mode === 'control' ? 'Voice: Device Control Mode' : 'Voice: Dictation Mode')
    })
    const unsub = dictationService.subscribe((payload) => {
      setDictationState(payload)
      if (payload.text && payload.isFinal) showNotice(payload.text)
    })
    const unsubDesktopDictation = window.cuestaDesktop?.onDictationStatus((payload) => {
      dictationService.syncDesktopStatus(payload, true)
    })
    const unsubSpeechStatus = window.cuestaDesktop?.onSpeechStatus((status) => {
      dictationService.handleEngineStatus(status)
      setDictationState((prev) => ({ ...prev, engine: status.engine }))
    })
    const unsubMode = window.cuestaDesktop?.onWindowModeChanged((mode) => {
      setHudMode(mode)
    })
    const unsubHudCmd = window.cuestaDesktop?.onHudCommand((cmd) => {
      if (cmd === 'toggle-dictation') void dictationService.toggle()
      else if (cmd === 'toggle-pointer') togglePointer()
      else if (cmd === 'recenter-pointer') recenterPointer()
      else if (cmd === 'toggle-pause') togglePauseGestures()
      else if (cmd === 'toggle-voice-mode') toggleVoiceMode()
      else if (cmd === 'trigger-active' && activeProfile) {
        triggerActionRef.current(activeProfile.action, activeProfile.key, activeProfile.targetAppId, 'manual')
      }
    })
    const unsubShortcut = window.cuestaDesktop?.onShortcut((payload) => {
      if (payload.chord === 'Alt+C') recenterPointer()
      else if (payload.chord === 'Alt+P') togglePauseGestures()
    })
    return () => {
      dictationService.setActionHandler(null)
      dictationService.setVoiceModeHandler(null)
      unsub()
      unsubDesktopDictation?.()
      unsubSpeechStatus?.()
      unsubMode?.()
      unsubHudCmd?.()
      unsubShortcut?.()
    }
  }, [activeProfile])

  useEffect(() => () => {
    stopCameraStream(streamRef.current)
    trackerRef.current?.stop()
  }, [])

  useEffect(() => {
    const onPop = () => {
      const p = window.location.pathname.replace(/^\//, '')
      setPage(p === 'sandbox' || p === 'settings' ? (p as Page) : 'studio')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Demo sensor heartbeat when user explicitly tests without webcam
  useEffect(() => {
    if (sensorMode !== 'demo' || cameraState === 'ready') return
    let phase = 0
    const timer = window.setInterval(() => {
      phase += 0.16
      const wave = Math.max(0, Math.sin(phase))
      const feats = simulatedFeatureFrame(wave * 0.65, [2, 3])
      feats[52] = Math.sin(phase * 0.5) * 0.05
      feats[53] = Math.cos(phase * 0.4) * 0.03
      latestFeaturesRef.current = feats
      if (trainingRef.current.step === 'signal') trainingRef.current.checkAutoPeak(feats)
    }, 50)
    return () => window.clearInterval(timer)
  }, [sensorMode, cameraState])

  // Continuous Optical Face Landmarker — stays alive across ALL training steps & pages!
  useEffect(() => {
    if (sensorMode !== 'camera' || cameraState !== 'ready' || !videoRef.current) {
      trackerRef.current?.stop()
      trackerRef.current = null
      setVisionState('idle')
      return
    }
    const tracker = new LocalFaceTracker()
    let cancelled = false
    setVisionState('loading')

    tracker
      .initialize()
      .then(() => {
        if (cancelled || !videoRef.current) return
        trackerRef.current = tracker
        setVisionState('ready')
        tracker.start(videoRef.current, (frame) => {
          const feats = frame?.features ?? null
          latestFeaturesRef.current = feats
          if (!feats) return

          if (trainingRef.current.step === 'signal') {
            trainingRef.current.checkAutoPeak(feats)
          }

          const hpCfg = settingsRef.current.headPointer
          if (hpCfg.enabled && !settingsRef.current.gesturesPaused && feats.length >= 55) {
            const now = performance.now()
            const ptr = headPointerRef.current.update(
              feats[52],
              feats[53],
              hpCfg,
              window.screen?.width || window.innerWidth,
              window.screen?.height || window.innerHeight,
              now
            )
            if (desktopAvailable()) {
              sendCursorNorm(ptr.nx, ptr.ny)
            }
            if (now - lastCursorUiSyncRef.current >= 32) {
              lastCursorUiSyncRef.current = now
              setCursorUi(ptr)
            }
            if (ptr.dwellTriggered) {
              triggerActionRef.current('click', undefined, undefined, 'dwell')
            }
          }
        })
      })
      .catch(() => {
        if (!cancelled) setVisionState('unavailable')
        tracker.stop()
      })

    return () => {
      cancelled = true
      tracker.stop()
      if (trackerRef.current === tracker) trackerRef.current = null
    }
  }, [cameraState, sensorMode])

  // Multi-switch detection + Verify meter runner
  useEffect(() => {
    if (sensorMode === 'camera' && cameraState !== 'ready') return

    const timer = window.setInterval(() => {
      const live = latestFeaturesRef.current
      if (!live) return

      const step = trainingRef.current.step
      if (step === 'verify' && trainingRef.current.repetitionVectors.length) {
        const proto = averageVectors(trainingRef.current.repetitionVectors)
        const weights = computeFeatureWeights(
          proto,
          trainingRef.current.baselineRef.current.mean,
          trainingRef.current.signalKind
        )
        const score = computeMatchScore(
          live,
          proto,
          trainingRef.current.baselineRef.current.mean,
          weights,
          trainingRef.current.signalKind
        )
        setVerifyScore(score)
      }

      const result = multiDetectorRef.current.update(live, performance.now(), settingsRef.current.gesturesPaused)
      setMultiScores(result.scores)
      setActiveStates(result.activeStates)

      const isCalibratingOrTraining = step === 'baseline' || step === 'signal' || step === 'verify'
      if (!isCalibratingOrTraining && result.triggeredProfiles.length > 0) {
        for (const p of result.triggeredProfiles) {
          triggerActionRef.current(p.action, p.key, p.targetAppId, 'switch')
          showNotice(`Switch fired: ${p.name}`)
        }
      }

      if (activeProfile && result.scores[activeProfile.id] !== undefined) {
        setLiveScore(result.scores[activeProfile.id])
      } else {
        const scores = Object.values(result.scores)
        if (scores.length) setLiveScore(Math.max(...scores))
      }
    }, 40)

    return () => window.clearInterval(timer)
  }, [activeProfile, cameraState, sensorMode])

  // Broadcast live snapshot to standalone transparent HUD window
  useEffect(() => {
    if (!desktopAvailable() || hudMode !== 'hud') return
    window.cuestaDesktop?.syncHudState({
      cameraReady: cameraState === 'ready',
      visionReady: visionState === 'ready',
      pointerEnabled: settings.headPointer.enabled,
      dwellClick: settings.headPointer.dwellClick,
      dwellProgress: cursorUi.dwellProgress,
      armedCount,
      activeLabel: armedCount > 1 ? `${armedCount} Armed` : (activeProfile?.name ?? 'Standby'),
      liveScore,
      threshold: activeProfile?.sensitivity ?? 0.54,
      dictation: dictationState,
      notice,
      gesturesPaused: settings.gesturesPaused,
      voiceMode: settings.voiceMode,
      aiReady,
    })
  }, [
    hudMode,
    cameraState,
    visionState,
    settings.headPointer,
    settings.gesturesPaused,
    settings.voiceMode,
    aiReady,
    cursorUi.dwellProgress,
    armedCount,
    activeProfile,
    liveScore,
    dictationState,
    notice,
  ])

  function navigate(next: Page) {
    setPage(next)
    const path = next === 'studio' ? '/' : `/${next}`
    window.history.pushState({}, '', path)
  }

  function showNotice(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice((curr) => (curr === msg ? '' : curr)), 4000)
  }

  function togglePauseGestures() {
    setSettings((curr) => {
      const next = !curr.gesturesPaused
      showNotice(next ? 'All gestures & head cursor paused (Alt+P to resume).' : 'Gestures resumed.')
      return { ...curr, gesturesPaused: next }
    })
  }

  function toggleVoiceMode(explicit?: VoiceMode) {
    setSettings((curr) => {
      const next: VoiceMode = explicit ?? (curr.voiceMode === 'dictation' ? 'control' : 'dictation')
      showNotice(next === 'control' ? 'Voice: Device Control Mode' : 'Voice: Dictation Mode')
      return { ...curr, voiceMode: next }
    })
  }

  function updateHeadPointer(patch: Partial<HeadPointerConfig>) {
    setSettings((curr) => ({ ...curr, headPointer: { ...curr.headPointer, ...patch } }))
  }

  function recenterPointer() {
    const feats = latestFeaturesRef.current
    headPointerRef.current.recenter(feats?.[52], feats?.[53])
    setCursorUi({ nx: 0.5, ny: 0.5, dwellProgress: 0 })
    if (desktopAvailable() && settingsRef.current.headPointer.enabled) {
      sendCursorNorm(0.5, 0.5)
    }
    showNotice('Head cursor centered.')
  }

  function togglePointer() {
    const nextEnabled = !settingsRef.current.headPointer.enabled
    if (nextEnabled) {
      const feats = latestFeaturesRef.current
      headPointerRef.current.recenter(feats?.[52], feats?.[53])
      setCursorUi({ nx: 0.5, ny: 0.5, dwellProgress: 0 })
      showNotice('Head cursor active. Steer gently with your head.')
    } else {
      showNotice('Head cursor paused.')
    }
    updateHeadPointer({ enabled: nextEnabled })
  }

  async function toggleHudMode() {
    const nextMode = hudMode === 'studio' ? 'hud' : 'studio'
    setHudMode(nextMode)
    await setDesktopWindowMode(nextMode)
  }

  async function enableCamera(): Promise<boolean> {
    setCameraState('requesting')
    try {
      const stream = await requestCameraStream()
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => undefined)
      }
      setCameraState('ready')
      setSensorMode('camera')
      showNotice('Camera initialized locally in memory.')
      return true
    } catch (error) {
      setCameraState('blocked')
      showNotice(error instanceof Error ? error.message : 'Camera permission denied.')
      return false
    }
  }

  function triggerAction(action: ActionKind, mappedKey?: string, targetApp?: string, source = 'switch') {
    window.dispatchEvent(new CustomEvent('cuesta:action:triggered', { detail: { action, source } }))

    if (action === 'toggle-pointer') {
      togglePointer()
      return
    }
    if (action === 'recenter-pointer') {
      recenterPointer()
      return
    }
    if (action === 'pause-gestures') {
      togglePauseGestures()
      return
    }
    if (action === 'dictation') {
      void dictationService.toggle()
      return
    }

    if (action === 'click' || action === 'double-click' || action === 'right-click') {
      setCursorJustClicked(true)
      window.setTimeout(() => setCursorJustClicked(false), 180)
      if (desktopAvailable()) {
        void sendCursorClick(action)
      }
      // Guarantee in-app interactive elements & focused scan targets receive click
      const vx = cursorUi.nx * window.innerWidth
      const vy = cursorUi.ny * window.innerHeight
      const clicked = settingsRef.current.headPointer.enabled ? clickDomElementAt(vx, vy) : false
      if (!clicked) {
        const focused = document.querySelector('[data-scan-focused="true"], .scan-focused') as HTMLElement | null
        focused?.click()
      }
      return
    }

    if (action === 'select') {
      const focusedScan = document.querySelector('[data-scan-focused="true"]') as HTMLElement | null
      if (focusedScan && document.hasFocus()) {
        focusedScan.click()
        return
      }
      void sendDesktopAction('select', mappedKey || 'Enter', targetApp)
      return
    }

    const effectiveKey = mappedKey || 'Enter'
    const effectiveApp = targetApp || 'microsoft-edge'
    void sendDesktopAction(action, effectiveKey, effectiveApp)

    if (action === 'scroll-down') window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' })
    if (action === 'scroll-up') window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' })
    if (action === 'back') navigate('studio')
    if (action === 'launch-app') {
      void launchDesktopApp(effectiveApp)
      showNotice(`Launching: ${effectiveApp}`)
    }
  }
  triggerActionRef.current = triggerAction

  function deleteProfile(id: string) {
    setProfiles((curr) => curr.filter((p) => p.id !== id))
    if (settings.activeProfileId === id) setSettings((curr) => ({ ...curr, activeProfileId: null }))
    showNotice('Switch removed.')
  }

  function toggleProfileEnabled(id: string) {
    setProfiles((curr) => curr.map((p) => (p.id === id ? { ...p, enabled: !(p.enabled ?? true) } : p)))
  }

  async function handleImportFile(file: File) {
    try {
      const imported = await importProfiles(file)
      setProfiles((curr) => [...imported, ...curr.filter((p) => !imported.some((item) => item.id === p.id))])
      showNotice(`${imported.length} switch(es) imported.`)
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="capture-video-hidden"
        aria-hidden="true"
      />

      {!desktopAvailable() && (
        <VirtualCursorOverlay
          visible={settings.headPointer.enabled}
          nx={cursorUi.nx}
          ny={cursorUi.ny}
          dwellProgress={cursorUi.dwellProgress}
          justClicked={cursorJustClicked}
        />
      )}

      {hudMode === 'hud' && !desktopAvailable() ? (
        <div className="compact-hud-root">
          <CompactHudView
            activeProfile={activeProfile}
            liveScore={liveScore}
            cameraReady={cameraState === 'ready'}
            pointerEnabled={settings.headPointer.enabled}
            gesturesPaused={settings.gesturesPaused}
            voiceMode={settings.voiceMode}
            dictationState={dictationState}
            armedCount={armedCount}
            notice={notice}
            onExpandStudio={() => void toggleHudMode()}
            onToggleDictation={() => void dictationService.toggle()}
            onToggleVoiceMode={() => toggleVoiceMode()}
            onTogglePause={togglePauseGestures}
            onTogglePointer={togglePointer}
            onRecenterPointer={recenterPointer}
            onTriggerActive={() =>
              activeProfile && triggerAction(activeProfile.action, activeProfile.key, activeProfile.targetAppId, 'manual')
            }
          />
        </div>
      ) : (
        <div className="cuesta-app-shell">
          <Sidebar
            page={page}
            onNavigate={navigate}
            activeProfile={activeProfile}
            profileCount={profiles.length}
          />

          <div className="cuesta-workspace-column">
            {desktopAvailable() && (
              <div className="cuesta-titlebar" aria-hidden="true">
                <span className="titlebar-caption">CUESTA CONTROL LAYER</span>
              </div>
            )}

            <HudTopBar
              cameraState={cameraState}
              dictationState={dictationState}
              pointerEnabled={settings.headPointer.enabled}
              gesturesPaused={settings.gesturesPaused}
              voiceMode={settings.voiceMode}
              aiReady={aiReady && settings.ollamaEnabled}
              armedCount={armedCount}
              onToggleCompact={() => void toggleHudMode()}
              onToggleDictation={() => void dictationService.toggle()}
              onToggleVoiceMode={() => toggleVoiceMode()}
              onTogglePause={togglePauseGestures}
              onTogglePointer={togglePointer}
              onRecenterPointer={recenterPointer}
            />

            <main className="cuesta-main-viewport">
              {page === 'studio' && (
                <StudioPage
                  stream={streamRef.current}
                  cameraState={cameraState}
                  visionState={visionState}
                  profiles={profiles}
                  multiScores={multiScores}
                  activeStates={activeStates}
                  verifyScore={verifyScore}
                  headPointer={settings.headPointer}
                  gesturesPaused={settings.gesturesPaused}
                  cursorUi={cursorUi}
                  training={training}
                  onToggleProfile={toggleProfileEnabled}
                  onDeleteProfile={deleteProfile}
                  onTogglePause={togglePauseGestures}
                  onRequestCamera={enableCamera}
                  onTriggerProfileAction={(p) => triggerAction(p.action, p.key, p.targetAppId, 'manual')}
                  onTriggerTestPulse={(act, k, app) => triggerAction(act, k, app, 'manual')}
                  onUpdateHeadPointer={updateHeadPointer}
                  onRecenterPointer={recenterPointer}
                  onEnableDemoMode={() => {
                    setSensorMode('demo')
                    showNotice('Demo sensor enabled. Simulated eyebrow pulse running.')
                  }}
                />
              )}

              {page === 'sandbox' && (
                <SandboxPage
                  onTriggerAction={(act) => triggerAction(act, undefined, undefined, 'manual')}
                  dictationState={dictationState}
                  pointerEnabled={settings.headPointer.enabled}
                  voiceMode={settings.voiceMode}
                  onToggleVoiceMode={toggleVoiceMode}
                  onTogglePointer={togglePointer}
                  onNotice={showNotice}
                />
              )}

              {page === 'settings' && (
                <SettingsPage
                  settings={settings}
                  profiles={profiles}
                  onUpdateSettings={setSettings}
                  onExportProfiles={() => exportProfiles(profiles)}
                  onImportProfiles={handleImportFile}
                  onResetProfiles={() => {
                    const d = { ...demoProfile, id: `demo-${Date.now()}` }
                    setProfiles([d])
                    setSettings((curr) => ({ ...curr, activeProfileId: d.id }))
                    showNotice('Reset to demo eyebrow click switch.')
                  }}
                  onNotice={showNotice}
                />
              )}
            </main>
          </div>

          {notice && (
            <div className="cuesta-toast" role="status">
              <Check size={14} className="text-accent" />
              <span>{notice}</span>
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => setNotice('')}
                aria-label="Dismiss notice"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
