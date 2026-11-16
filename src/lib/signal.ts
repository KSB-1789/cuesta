import type { SignalKind, SwitchProfile } from './types'

export const SIGNAL_FEATURE_INDICES: Record<SignalKind, number[]> = {
  eyebrow: [2, 3, 4], // browInnerUp, browOuterUpLeft, browOuterUpRight (isolated from browDown)
  'brow-furrow': [0, 1], // browDownLeft, browDownRight
  'head-tilt': [54, 52], // headRoll, headYaw
  'head-turn': [52], // headYaw
  nod: [53], // headPitch
  'mouth-open': [24, 45, 46], // jawOpen, mouthStretchLeft, mouthStretchRight
  'mouth-pucker': [37], // mouthPucker
  smile: [43, 44, 27, 28], // mouthSmileLeft, mouthSmileRight, mouthDimpleLeft, mouthDimpleRight
  jaw: [22, 23, 24, 25], // jawForward, jawLeft, jawOpen, jawRight
  'blink-hold': [8, 9], // eyeBlinkLeft, eyeBlinkRight
  'wink-left': [8], // eyeBlinkLeft only
  'wink-right': [9], // eyeBlinkRight only
  squint: [6, 7, 18, 19], // cheekSquintLeft/Right, eyeSquintLeft/Right
  'cheek-puff': [5], // cheekPuff
  'finger-snap': [], // detected via acoustic transient FFT
}

export function averageVectors(vectors: number[][]): number[] {
  if (!vectors.length) return []
  const size = vectors[0].length
  return Array.from({ length: size }, (_, index) =>
    vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) / vectors.length
  )
}

export function normalizeFeatures(raw: number[], mean: number[], std: number[]): number[] {
  return raw.map((value, index) => (value - (mean[index] ?? 0)) / Math.max(std[index] ?? 0.05, 0.05))
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function smoothScore(history: number[], next: number, windowSize = 5): number {
  const nextHistory = [...history, next].slice(-windowSize)
  return nextHistory.reduce((sum, value) => sum + value, 0) / nextHistory.length
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let index = 0; index < size; index += 1) {
    dot += a[index] * b[index]
    magA += a[index] ** 2
    magB += b[index] ** 2
  }
  if (!magA || !magB) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export function computeFeatureWeights(
  prototype: number[],
  baselineMean: number[],
  signalKind?: SignalKind
): number[] {
  const size = Math.min(prototype.length, baselineMean.length)
  const deltas = Array.from({ length: size }, (_, i) => Math.abs((prototype[i] ?? 0) - (baselineMean[i] ?? 0)))

  const priorIndices = signalKind ? SIGNAL_FEATURE_INDICES[signalKind] || [] : []
  const maxPriorDelta = priorIndices.length
    ? priorIndices.reduce((max, idx) => Math.max(max, deltas[idx] ?? 0), 0)
    : 0
  const useStrictTargetFocus = priorIndices.length > 0 && maxPriorDelta >= 0.04

  const weights = deltas.map((delta, i) => {
    const isTarget = priorIndices.includes(i)
    if (useStrictTargetFocus && !isTarget) {
      // Suppress transient blink / posture jitter outside the chosen movement channel
      if (delta < Math.max(0.18, maxPriorDelta * 0.75)) return 0
      return (delta ** 2) * 0.25
    }
    const base = delta ** 2
    return isTarget ? base * 12.0 : base
  })

  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0.0001) return Array(size).fill(1 / size)
  return weights.map((w) => w / total)
}

export function applySignalAccuracyGuard(
  signal: SignalKind,
  liveFeatures: number[],
  baselineMean: number[],
  rawScore: number
): number {
  if (rawScore <= 0) return 0

  if (signal === 'blink-hold' && liveFeatures.length >= 10) {
    const blinkLeft = liveFeatures[8] ?? 0
    const blinkRight = liveFeatures[9] ?? 0
    const minEye = Math.min(blinkLeft, blinkRight)
    const asymmetry = Math.abs(blinkLeft - blinkRight)
    // Closing one eye only (or asymmetrical wink) must NOT trigger Both-Eyes Blink
    if (minEye < 0.25 || (asymmetry > 0.28 && Math.max(blinkLeft, blinkRight) > 0.35)) {
      return rawScore * 0.2
    }
  }

  if (signal === 'wink-left' && liveFeatures.length >= 10) {
    const blinkLeft = liveFeatures[8] ?? 0
    const blinkRight = liveFeatures[9] ?? 0
    // Left eye must close noticeably more than right eye (blocks two-eye blinks)
    if (blinkLeft < 0.30 || blinkLeft - blinkRight < 0.16) {
      return rawScore * 0.2
    }
  }

  if (signal === 'wink-right' && liveFeatures.length >= 10) {
    const blinkLeft = liveFeatures[8] ?? 0
    const blinkRight = liveFeatures[9] ?? 0
    // Right eye must close noticeably more than left eye (blocks two-eye blinks)
    if (blinkRight < 0.30 || blinkRight - blinkLeft < 0.16) {
      return rawScore * 0.2
    }
  }

  if (signal === 'cheek-puff' && liveFeatures.length >= 6) {
    const cheekLevel = liveFeatures[5] ?? 0
    const baselineCheek = baselineMean[5] ?? 0
    // Ignore light breathing ripples or swallowing pressure spikes
    if (cheekLevel < 0.25 || cheekLevel - baselineCheek < 0.18) {
      return rawScore * 0.25
    }
  }

  if (signal === 'eyebrow' && liveFeatures.length >= 5) {
    const browUp = Math.max(liveFeatures[2] ?? 0, liveFeatures[3] ?? 0, liveFeatures[4] ?? 0)
    const browDown = Math.max(liveFeatures[0] ?? 0, liveFeatures[1] ?? 0)
    if (browDown > browUp + 0.12) {
      return rawScore * 0.35
    }
  }

  if (signal === 'brow-furrow' && liveFeatures.length >= 5) {
    const browUp = Math.max(liveFeatures[2] ?? 0, liveFeatures[3] ?? 0, liveFeatures[4] ?? 0)
    const browDown = Math.max(liveFeatures[0] ?? 0, liveFeatures[1] ?? 0)
    if (browUp > browDown + 0.12) {
      return rawScore * 0.35
    }
  }

  return rawScore
}

export function computeMatchScore(
  live: number[],
  prototype: number[],
  baselineMean: number[],
  weights?: number[],
  signalKind?: SignalKind
): number {
  const size = Math.min(live.length, prototype.length, baselineMean.length)
  if (size === 0) return 0

  const resolvedWeights =
    weights && weights.length >= size ? weights : computeFeatureWeights(prototype, baselineMean, signalKind)

  let scoreSum = 0
  let weightSum = 0

  for (let i = 0; i < size; i++) {
    const w = resolvedWeights[i] ?? 0
    if (w <= 0.0001) continue

    const protoDelta = (prototype[i] ?? 0) - (baselineMean[i] ?? 0)
    const liveDelta = (live[i] ?? 0) - (baselineMean[i] ?? 0)

    if (Math.abs(protoDelta) < 0.02) continue

    const ratio = liveDelta / protoDelta
    const clampedRatio = clamp(ratio, 0, 1.25)
    scoreSum += w * Math.min(1.0, clampedRatio)
    weightSum += w
  }

  if (weightSum === 0) return 0
  const raw = clamp(scoreSum / weightSum, 0, 1)
  return signalKind ? applySignalAccuracyGuard(signalKind, live, baselineMean, raw) : raw
}

export class SwitchDetector {
  private aboveSince: number | null = null
  private lastTrigger = -Infinity
  private active = false
  private triggeredInCurrentActivation = false
  private history: number[] = []

  constructor(
    private threshold: number,
    private holdMs: number,
    private cooldownMs: number,
  ) {}

  update(score: number, now = performance.now()): { score: number; triggered: boolean; active: boolean } {
    const smoothed = smoothScore(this.history, score, 5)
    this.history = [...this.history, score].slice(-8)
    const release = Math.max(0.12, this.threshold - 0.15)

    if (smoothed >= this.threshold) {
      if (this.aboveSince === null) {
        this.aboveSince = now
        this.triggeredInCurrentActivation = false
      }
      this.active = true
    } else if (smoothed < release) {
      this.aboveSince = null
      this.active = false
      this.triggeredInCurrentActivation = false
    }

    const held = this.aboveSince !== null && now - this.aboveSince >= this.holdMs
    const cooldownPassed = now - this.lastTrigger >= this.cooldownMs
    const triggered = held && cooldownPassed && !this.triggeredInCurrentActivation
    if (triggered) {
      this.lastTrigger = now
      this.triggeredInCurrentActivation = true
    }
    return { score: smoothed, triggered, active: this.active }
  }

  public updateConfig(threshold: number, holdMs: number, cooldownMs: number): void {
    this.threshold = threshold
    this.holdMs = holdMs
    this.cooldownMs = cooldownMs
  }
}

export interface MultiSwitchResult {
  scores: Record<string, number>
  triggeredProfiles: SwitchProfile[]
  activeStates: Record<string, boolean>
}

export class MultiSwitchDetector {
  private instances: Map<
    string,
    {
      profile: SwitchProfile
      detector: SwitchDetector
      weights: number[]
    }
  > = new Map()

  constructor(profiles: SwitchProfile[] = []) {
    this.setProfiles(profiles)
  }

  public setProfiles(profiles: SwitchProfile[]) {
    const nextMap = new Map()
    for (const prof of profiles) {
      if (!prof.enabled) continue
      const existing = this.instances.get(prof.id)
      const weights =
        prof.weights ||
        computeFeatureWeights(prof.prototype, prof.baseline.mean, prof.signal)
      let detector: SwitchDetector
      if (existing && existing.detector) {
        detector = existing.detector
        detector.updateConfig(prof.sensitivity, prof.holdMs, prof.cooldownMs)
      } else {
        detector = new SwitchDetector(prof.sensitivity, prof.holdMs, prof.cooldownMs)
      }
      nextMap.set(prof.id, { profile: prof, detector, weights })
    }
    this.instances = nextMap
  }

  public update(liveFeatures: number[], now = performance.now(), paused = false): MultiSwitchResult {
    const scores: Record<string, number> = {}
    const activeStates: Record<string, boolean> = {}
    const triggeredProfiles: import('./types').SwitchProfile[] = []

    for (const [id, instance] of this.instances.entries()) {
      const { profile, detector, weights } = instance
      if (profile.signal === 'finger-snap') {
        scores[id] = 0
        activeStates[id] = false
        continue
      }

      const canEvaluate = !paused || profile.action === 'pause-gestures'
      const score = canEvaluate
        ? computeMatchScore(
            liveFeatures,
            profile.prototype,
            profile.baseline.mean,
            weights,
            profile.signal
          )
        : 0

      scores[id] = score
      const res = detector.update(score, now)
      activeStates[id] = canEvaluate && res.active
      if (canEvaluate && res.triggered) {
        triggeredProfiles.push(profile)
      }
    }

    return { scores, triggeredProfiles, activeStates }
  }

  public getActiveCount(): number {
    return this.instances.size
  }
}

export class MovementPeakDetector {
  private rising = false
  private peakValue = 0
  private peakVector: number[] | null = null

  constructor(
    private threshold = 0.20,
    private releaseRatio = 0.55
  ) {}

  public update(magnitude: number, vector: number[]): { completed: boolean; peakVector: number[] | null; peakMagnitude: number } {
    if (!this.rising) {
      if (magnitude >= this.threshold) {
        this.rising = true
        this.peakValue = magnitude
        this.peakVector = [...vector]
      }
      return { completed: false, peakVector: null, peakMagnitude: 0 }
    }

    if (magnitude > this.peakValue) {
      this.peakValue = magnitude
      this.peakVector = [...vector]
    }

    const releaseThreshold = this.threshold * this.releaseRatio
    if (magnitude <= releaseThreshold) {
      const completedVector = this.peakVector
      const completedMag = this.peakValue
      this.rising = false
      this.peakValue = 0
      this.peakVector = null
      return { completed: true, peakVector: completedVector, peakMagnitude: completedMag }
    }

    return { completed: false, peakVector: null, peakMagnitude: 0 }
  }

  public reset(): void {
    this.rising = false
    this.peakValue = 0
    this.peakVector = null
  }
}
