import { useEffect, useRef, useState } from 'react'
import type { ActionKind, SignalKind, SwitchProfile, TrainingStep, SensorMode } from './types'
import { averageVectors, computeFeatureWeights, SIGNAL_FEATURE_INDICES, MovementPeakDetector } from './signal'
import { FingerSnapDetector } from './snap-detector'
import { SIGNAL_DEFAULTS, signalLabels, simulatedFeatureFrame } from './vision'

export interface UseSwitchTrainingOptions {
  sensorMode: SensorMode
  latestFeaturesRef: React.MutableRefObject<number[] | null>
  onNotice: (msg: string) => void
  onSaveProfile: (profile: SwitchProfile) => void
}

export function useSwitchTraining({
  sensorMode,
  latestFeaturesRef,
  onNotice,
  onSaveProfile,
}: UseSwitchTrainingOptions) {
  const [step, setStep] = useState<TrainingStep>('setup')
  const [signalKind, setSignalKindState] = useState<SignalKind>('eyebrow')
  const [actionKind, setActionKind] = useState<ActionKind>('click')
  const [signalName, setSignalName] = useState('')
  const [keyValue, setKeyValue] = useState('Enter')
  const [targetAppId, setTargetAppId] = useState('microsoft-edge')
  const [calibrationProgress, setCalibrationProgress] = useState(0)
  const [repetitions, setRepetitions] = useState(0)
  const repetitionsRef = useRef(0)
  const [repetitionVectors, setRepetitionVectors] = useState<number[][]>([])
  const [sensitivity, setSensitivity] = useState(SIGNAL_DEFAULTS.eyebrow.sensitivity)
  const [holdMs, setHoldMs] = useState(SIGNAL_DEFAULTS.eyebrow.holdMs)
  const [cooldownMs, setCooldownMs] = useState(SIGNAL_DEFAULTS.eyebrow.cooldownMs)

  function setSignalKind(kind: SignalKind) {
    setSignalKindState(kind)
    const defaults = SIGNAL_DEFAULTS[kind]
    if (defaults) {
      setSensitivity(defaults.sensitivity)
      setHoldMs(defaults.holdMs)
      setCooldownMs(defaults.cooldownMs)
    }
  }
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null)
  const [liveDeparture, setLiveDeparture] = useState(0)

  const baselineSamplesRef = useRef<number[][]>([])
  const baselineRef = useRef<{ mean: number[]; std: number[] }>({
    mean: Array(55).fill(0.04),
    std: Array(55).fill(0.08),
  })
  const peakDetectorRef = useRef(new MovementPeakDetector(0.14, 0.48))
  const [autoPeakNotice, setAutoPeakNotice] = useState('')

  const recordRepetitionRef = useRef<(customVector?: number[]) => void>(() => undefined)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && step === 'signal') {
        const active = document.activeElement
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        e.preventDefault()
        recordRepetitionRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step])

  // Acoustic Finger-Snap calibration during Step 2 & Verify when training 'finger-snap'
  useEffect(() => {
    if (signalKind !== 'finger-snap' || (step !== 'signal' && step !== 'verify')) return
    const detector = new FingerSnapDetector()
    const unsubSnap = detector.subscribe(() => {
      if (step === 'signal') {
        recordRepetitionRef.current(Array(55).fill(0.04))
        setAutoPeakNotice('Snap captured (Audio transient)')
      } else if (step === 'verify') {
        setLiveDeparture(1)
        window.setTimeout(() => setLiveDeparture(0), 220)
      }
    })
    const unsubLevel = detector.subscribeLevel((level) => {
      if (step === 'signal') setLiveDeparture(level)
    })
    void detector.start()
    return () => {
      unsubSnap()
      unsubLevel()
      detector.stop()
    }
  }, [signalKind, step])

  function checkAutoPeak(features: number[]) {
    if (step !== 'signal' || signalKind === 'finger-snap') return
    const indices = SIGNAL_FEATURE_INDICES[signalKind] || []
    const baselineMean = baselineRef.current.mean

    // Bilateral check during blink-hold training so accidental one-eye winks aren't captured
    if (signalKind === 'blink-hold' && features.length >= 10) {
      const l = features[8] ?? 0
      const r = features[9] ?? 0
      if (Math.abs(l - r) > 0.30 && Math.max(l, r) > 0.35) {
        setLiveDeparture(0.08)
        return
      }
    }

    let maxDelta = 0
    for (const idx of indices) {
      const delta = Math.abs((features[idx] ?? 0) - (baselineMean[idx] ?? 0))
      if (delta > maxDelta) maxDelta = delta
    }
    if (maxDelta < 0.04 && features.length > 50) {
      maxDelta = features.slice(0, 52).reduce((max, val, i) => {
        const d = Math.abs(val - (baselineMean[i] ?? 0))
        return d > max ? d : max
      }, 0)
    }

    setLiveDeparture(Math.min(1, maxDelta))
    const res = peakDetectorRef.current.update(maxDelta, features)
    if (res.completed && res.peakVector) {
      recordRepetition(res.peakVector)
      setAutoPeakNotice(`Peak captured (${Math.round(res.peakMagnitude * 100)}%)`)
    }
  }

  function startCalibration() {
    setStep('baseline')
    setCalibrationProgress(0)
    setRepetitions(0)
    repetitionsRef.current = 0
    setRepetitionVectors([])
    setLiveDeparture(0)
    setAutoPeakNotice('')
    peakDetectorRef.current.reset()
    baselineSamplesRef.current = []
    const started = Date.now()

    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 2600)
      setCalibrationProgress(progress)

      if (sensorMode === 'camera' && latestFeaturesRef.current) {
        baselineSamplesRef.current.push(latestFeaturesRef.current)
      }

      if (progress >= 1) {
        window.clearInterval(timer)
        if (sensorMode === 'camera' && baselineSamplesRef.current.length >= 3) {
          const mean = averageVectors(baselineSamplesRef.current)
          const std = mean.map((val, idx) =>
            Math.max(
              0.03,
              Math.sqrt(
                baselineSamplesRef.current.reduce((sum, s) => sum + (s[idx] - val) ** 2, 0) /
                  baselineSamplesRef.current.length
              )
            )
          )
          baselineRef.current = { mean, std }
        } else {
          baselineRef.current = { mean: Array(55).fill(0.04), std: Array(55).fill(0.08) }
        }
        setStep('signal')
        onNotice('Resting face calibrated. Perform your movement 3 times.')
      }
    }, 50)
  }

  function recordRepetition(customVector?: number[]) {
    if (repetitionsRef.current >= 3) return
    const next = repetitionsRef.current + 1
    repetitionsRef.current = next
    const vector =
      customVector ||
      (sensorMode === 'camera' && latestFeaturesRef.current
        ? [...latestFeaturesRef.current]
        : simulatedFeatureFrame(0.55 + next * 0.1, SIGNAL_FEATURE_INDICES[signalKind] || [2, 3]))

    setRepetitions(next)
    setRepetitionVectors((curr) => [...curr, vector])
    if (next >= 3) {
      setStep('verify')
      onNotice('3 repetitions captured. Perform movement now to test trigger before saving.')
    }
  }
  recordRepetitionRef.current = recordRepetition

  function saveSwitch() {
    const label = signalName.trim() || signalLabels[signalKind]
    const fallbackVector = simulatedFeatureFrame(0.7, SIGNAL_FEATURE_INDICES[signalKind] || [2, 3])
    const prototype = averageVectors(repetitionVectors.length ? repetitionVectors : [fallbackVector])
    const weights = computeFeatureWeights(prototype, baselineRef.current.mean, signalKind)

    const profile: SwitchProfile = {
      id: `${signalKind}-${Date.now()}`,
      name: label,
      signal: signalKind,
      action: actionKind,
      key: actionKind === 'key' ? keyValue : undefined,
      targetAppId: actionKind === 'launch-app' ? targetAppId : undefined,
      sensitivity,
      holdMs,
      cooldownMs,
      prototype,
      baseline: baselineRef.current,
      weights,
      repetitions: Math.max(3, repetitions),
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    onSaveProfile(profile)
    setSavedProfileId(profile.id)
    setStep('done')
    onNotice(`${label} is armed and ready.`)
  }

  function resetTraining() {
    setStep('setup')
    setRepetitions(0)
    repetitionsRef.current = 0
    setRepetitionVectors([])
    setCalibrationProgress(0)
    setLiveDeparture(0)
    setSavedProfileId(null)
    setAutoPeakNotice('')
    peakDetectorRef.current.reset()
  }

  return {
    step,
    signalKind,
    actionKind,
    signalName,
    keyValue,
    targetAppId,
    calibrationProgress,
    repetitions,
    repetitionVectors,
    sensitivity,
    holdMs,
    cooldownMs,
    savedProfileId,
    baselineRef,
    autoPeakNotice,
    liveDeparture,
    checkAutoPeak,
    setStep,
    setSignalKind,
    setActionKind,
    setSignalName,
    setKeyValue,
    setTargetAppId,
    setSensitivity,
    setHoldMs,
    setCooldownMs,
    startCalibration,
    recordRepetition,
    saveSwitch,
    resetTraining,
  }
}
