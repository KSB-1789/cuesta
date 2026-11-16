import { describe, expect, it } from 'vitest'
import {
  averageVectors,
  computeFeatureWeights,
  computeMatchScore,
  MultiSwitchDetector,
  normalizeFeatures,
  SIGNAL_FEATURE_INDICES,
  MovementPeakDetector,
} from './signal'

describe('signal math & feature weighted matching', () => {
  it('normalizes a feature vector against baseline statistics', () => {
    expect(normalizeFeatures([3, 6], [1, 2], [1, 2])).toEqual([2, 2])
  })

  it('averages repeated samples into a prototype', () => {
    expect(averageVectors([[1, 3], [3, 5]])).toEqual([2, 4])
  })

  it('computes feature weights prioritizing active signal features', () => {
    const baseline = Array(55).fill(0.02)
    const prototype = Array(55).fill(0.02)
    // Eyebrow raise moved index 2 (browInnerUp) and index 3 (browOuterUpLeft)
    prototype[2] = 0.55
    prototype[3] = 0.45

    const weights = computeFeatureWeights(prototype, baseline, 'eyebrow')
    expect(weights[2]).toBeGreaterThan(weights[10])
    expect(weights[3]).toBeGreaterThan(weights[20])
  })

  it('prevents stray blink during eyebrow training from ruining later clean eyebrow matches', () => {
    const baseline = Array(55).fill(0.02)
    const noisyProto = Array(55).fill(0.02)
    noisyProto[2] = 0.50 // browInnerUp
    noisyProto[3] = 0.45 // browOuterUpLeft
    noisyProto[8] = 0.28 // accidental partial blink during training sample

    const weights = computeFeatureWeights(noisyProto, baseline, 'eyebrow')
    // Clean eyebrow raise without blinking later in real usage
    const cleanLive = Array(55).fill(0.02)
    cleanLive[2] = 0.48
    cleanLive[3] = 0.43

    const score = computeMatchScore(cleanLive, noisyProto, baseline, weights)
    expect(score).toBeGreaterThan(0.85)
  })

  it('accurately distinguishes resting neutral from active gesture', () => {
    const baseline = Array(55).fill(0.02)
    const prototype = Array(55).fill(0.02)
    prototype[2] = 0.60 // browInnerUp
    prototype[3] = 0.50 // browOuterUpLeft

    const weights = computeFeatureWeights(prototype, baseline, 'eyebrow')

    // 1. Resting face: live == baseline
    const restingLive = Array(55).fill(0.02)
    const restingScore = computeMatchScore(restingLive, prototype, baseline, weights)
    expect(restingScore).toBeLessThan(0.05) // Near 0% at rest!

    // 2. Active gesture: live == prototype
    const activeLive = [...prototype]
    const activeScore = computeMatchScore(activeLive, prototype, baseline, weights)
    expect(activeScore).toBeGreaterThan(0.95) // Near 100% when active!

    // 3. Unrelated gesture (e.g. smile or jaw open while trained on eyebrow)
    const unrelatedLive = Array(55).fill(0.02)
    unrelatedLive[24] = 0.80 // jawOpen is high, but eyebrow is neutral
    unrelatedLive[43] = 0.75 // mouthSmileLeft is high
    const unrelatedScore = computeMatchScore(unrelatedLive, prototype, baseline, weights)
    expect(unrelatedScore).toBeLessThan(0.05) // Ignored! No false trigger!
  })

  it('accurately tracks multiple simultaneous gestures without mutual interference', () => {
    const baseline = Array(55).fill(0.02)

    // Profile 1: Eyebrow raise (indices 2, 3)
    const protoEyebrow = Array(55).fill(0.02)
    protoEyebrow[2] = 0.60
    protoEyebrow[3] = 0.50

    // Profile 2: Smile (indices 43, 44)
    const protoSmile = Array(55).fill(0.02)
    protoSmile[43] = 0.70
    protoSmile[44] = 0.70

    // Profile 3: Jaw Open (index 24)
    const protoJaw = Array(55).fill(0.02)
    protoJaw[24] = 0.80

    const profile1 = {
      id: 'sw-eyebrow',
      name: 'Eyebrow',
      signal: 'eyebrow' as const,
      action: 'select' as const,
      sensitivity: 0.65,
      holdMs: 100,
      cooldownMs: 300,
      prototype: protoEyebrow,
      baseline: { mean: baseline, std: Array(55).fill(0.04) },
      repetitions: 3,
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    const profile2 = {
      id: 'sw-smile',
      name: 'Smile',
      signal: 'smile' as const,
      action: 'scroll-down' as const,
      sensitivity: 0.65,
      holdMs: 100,
      cooldownMs: 300,
      prototype: protoSmile,
      baseline: { mean: baseline, std: Array(55).fill(0.04) },
      repetitions: 3,
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    const profile3 = {
      id: 'sw-jaw',
      name: 'Mouth Open',
      signal: 'mouth-open' as const,
      action: 'dictation' as const,
      sensitivity: 0.65,
      holdMs: 100,
      cooldownMs: 300,
      prototype: protoJaw,
      baseline: { mean: baseline, std: Array(55).fill(0.04) },
      repetitions: 3,
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    const multi = new MultiSwitchDetector([profile1, profile2, profile3])
    expect(multi.getActiveCount()).toBe(3)

    // User smiles
    const smileFrame = Array(55).fill(0.02)
    smileFrame[43] = 0.72
    smileFrame[44] = 0.68

    let triggeredA: Array<any> = []
    for (let t = 0; t <= 120; t += 20) {
      const res = multi.update(smileFrame, t)
      if (res.triggeredProfiles.length) triggeredA.push(...res.triggeredProfiles)
    }

    // Only smile triggers! Eyebrow and Jaw remain untriggered!
    expect(triggeredA.some((p) => p.id === 'sw-smile')).toBe(true)
    expect(triggeredA.some((p) => p.id === 'sw-eyebrow')).toBe(false)
    expect(triggeredA.some((p) => p.id === 'sw-jaw')).toBe(false)

    // User relaxes to neutral
    const neutralFrame = Array(55).fill(0.02)
    for (let t = 140; t <= 450; t += 20) {
      multi.update(neutralFrame, t)
    }

    // User raises eyebrows
    const eyebrowFrame = Array(55).fill(0.02)
    eyebrowFrame[2] = 0.62
    eyebrowFrame[3] = 0.52

    let triggeredB: Array<any> = []
    for (let t = 500; t <= 750; t += 20) {
      const res = multi.update(eyebrowFrame, t)
      if (res.triggeredProfiles.length) triggeredB.push(...res.triggeredProfiles)
    }

    // Only eyebrow triggers!
    expect(triggeredB.some((p) => p.id === 'sw-eyebrow')).toBe(true)
    expect(triggeredB.some((p) => p.id === 'sw-smile')).toBe(false)
    expect(triggeredB.some((p) => p.id === 'sw-jaw')).toBe(false)

    // Relax again
    for (let t = 760; t <= 1000; t += 20) {
      multi.update(neutralFrame, t)
    }

    // Now user performs BOTH Eyebrow AND Smile simultaneously
    const comboFrame = Array(55).fill(0.02)
    comboFrame[2] = 0.62
    comboFrame[3] = 0.52
    comboFrame[43] = 0.72
    comboFrame[44] = 0.68

    let triggeredCombo: Array<any> = []
    for (let t = 1100; t <= 1350; t += 20) {
      const res = multi.update(comboFrame, t)
      if (res.triggeredProfiles.length) triggeredCombo.push(...res.triggeredProfiles)
    }

    // Both eyebrow and smile trigger simultaneously! Jaw still unaffected!
    expect(triggeredCombo.some((p) => p.id === 'sw-eyebrow')).toBe(true)
    expect(triggeredCombo.some((p) => p.id === 'sw-smile')).toBe(true)
    expect(triggeredCombo.some((p) => p.id === 'sw-jaw')).toBe(false)
  })

  it('detects a movement peak from resting, through peak, back to release', () => {
    const detector = new MovementPeakDetector(0.20, 0.50)

    const dummyVec = [0.1, 0.2, 0.3]
    // 1. Below threshold (rest)
    let res = detector.update(0.08, dummyVec)
    expect(res.completed).toBe(false)

    // 2. Rising above threshold
    res = detector.update(0.25, [0.2, 0.4, 0.6])
    expect(res.completed).toBe(false)

    // 3. Peak reaches highest point
    res = detector.update(0.42, [0.5, 0.8, 0.9])
    expect(res.completed).toBe(false)

    // 4. Relaxing down but still above release (0.20 * 0.50 = 0.10)
    res = detector.update(0.18, dummyVec)
    expect(res.completed).toBe(false)

    // 5. Relaxing below release threshold (0.07 <= 0.10) -> Peak completed!
    res = detector.update(0.07, dummyVec)
    expect(res.completed).toBe(true)
    expect(res.peakMagnitude).toBe(0.42)
    expect(res.peakVector).toEqual([0.5, 0.8, 0.9])
  })

  it('rejects one-eye winks on blink-hold and isolates left/right winks from symmetric blinking', () => {
    const baseline = Array(55).fill(0.02)

    const protoBoth = Array(55).fill(0.02)
    protoBoth[8] = 0.78
    protoBoth[9] = 0.78
    const weightsBoth = computeFeatureWeights(protoBoth, baseline, 'blink-hold')

    const oneEyeWink = Array(55).fill(0.02)
    oneEyeWink[8] = 0.85
    oneEyeWink[9] = 0.04
    expect(computeMatchScore(oneEyeWink, protoBoth, baseline, weightsBoth, 'blink-hold')).toBeLessThan(0.30)

    const cleanBoth = Array(55).fill(0.02)
    cleanBoth[8] = 0.76
    cleanBoth[9] = 0.75
    expect(computeMatchScore(cleanBoth, protoBoth, baseline, weightsBoth, 'blink-hold')).toBeGreaterThan(0.90)

    const protoLeft = Array(55).fill(0.02)
    protoLeft[8] = 0.80
    const weightsLeft = computeFeatureWeights(protoLeft, baseline, 'wink-left')
    expect(computeMatchScore(oneEyeWink, protoLeft, baseline, weightsLeft, 'wink-left')).toBeGreaterThan(0.90)
    expect(computeMatchScore(cleanBoth, protoLeft, baseline, weightsLeft, 'wink-left')).toBeLessThan(0.30)
  })

  it('suppresses light breathing puffs on cheek-puff and honors gesturesPaused while allowing unpause switch', () => {
    const baseline = Array(55).fill(0.02)
    const protoCheek = Array(55).fill(0.02)
    protoCheek[5] = 0.65
    const weightsCheek = computeFeatureWeights(protoCheek, baseline, 'cheek-puff')

    const breathingRipple = Array(55).fill(0.02)
    breathingRipple[5] = 0.14
    expect(computeMatchScore(breathingRipple, protoCheek, baseline, weightsCheek, 'cheek-puff')).toBeLessThan(0.20)

    const fullPuff = Array(55).fill(0.02)
    fullPuff[5] = 0.62
    expect(computeMatchScore(fullPuff, protoCheek, baseline, weightsCheek, 'cheek-puff')).toBeGreaterThan(0.85)

    const clickSwitch = {
      id: 'sw-cheek',
      name: 'Cheek Click',
      signal: 'cheek-puff' as const,
      action: 'click' as const,
      sensitivity: 0.55,
      holdMs: 80,
      cooldownMs: 300,
      prototype: protoCheek,
      baseline: { mean: baseline, std: Array(55).fill(0.04) },
      repetitions: 3,
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    const protoSmile = Array(55).fill(0.02)
    protoSmile[43] = 0.70
    protoSmile[44] = 0.70
    const pauseSwitch = {
      id: 'sw-unpause',
      name: 'Smile Toggle Pause',
      signal: 'smile' as const,
      action: 'pause-gestures' as const,
      sensitivity: 0.55,
      holdMs: 80,
      cooldownMs: 300,
      prototype: protoSmile,
      baseline: { mean: baseline, std: Array(55).fill(0.04) },
      repetitions: 3,
      trainedAt: new Date().toISOString(),
      enabled: true,
    }

    const multi = new MultiSwitchDetector([clickSwitch, pauseSwitch])
    const combo = Array(55).fill(0.02)
    combo[5] = 0.65
    combo[43] = 0.72
    combo[44] = 0.72

    const pausedTriggers: string[] = []
    for (let t = 0; t <= 120; t += 20) {
      const res = multi.update(combo, t, true)
      res.triggeredProfiles.forEach((p) => pausedTriggers.push(p.id))
    }

    expect(pausedTriggers).not.toContain('sw-cheek')
    expect(pausedTriggers).toContain('sw-unpause')
  })
})
