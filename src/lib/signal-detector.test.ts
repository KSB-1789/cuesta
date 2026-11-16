import { describe, expect, it } from 'vitest'
import { clamp, smoothScore, SwitchDetector } from './signal'

describe('switch detector', () => {
  it('waits for the configured hold time and respects cooldown', () => {
    const detector = new SwitchDetector(0.7, 200, 500)
    // Initially not triggered
    expect(detector.update(0.9, 0).triggered).toBe(false)
    // At 199ms, still not held enough
    expect(detector.update(0.9, 199).triggered).toBe(false)
    // At 201ms, held for >200ms -> triggers
    expect(detector.update(0.9, 201).triggered).toBe(true)
    // Still during cooldown -> does not trigger again
    expect(detector.update(0.9, 300).triggered).toBe(false)
    // After cooldown and drop below release
    for (let timestamp = 400; timestamp <= 1100; timestamp += 100) {
      detector.update(0.2, timestamp)
    }
    expect(detector.update(0.2, 1200).active).toBe(false)
  })

  it('handles hysteresis so small dips do not immediately release active state', () => {
    const detector = new SwitchDetector(0.7, 100, 400)
    // Fill history with high score to trigger
    for (let t = 0; t <= 120; t += 20) {
      detector.update(0.85, t)
    }
    const state = detector.update(0.85, 130)
    expect(state.active).toBe(true)

    // A dip slightly below 0.70 (e.g. 0.65) is still >= release threshold (0.60)
    // so active stays true due to hysteresis
    const dipped = detector.update(0.65, 140)
    expect(dipped.active).toBe(true)

    // A major dip below 0.60 resets active
    for (let t = 150; t <= 300; t += 20) {
      detector.update(0.1, t)
    }
    expect(detector.update(0.1, 320).active).toBe(false)
  })

  it('clamps and smooths values correctly', () => {
    expect(clamp(-0.5)).toBe(0)
    expect(clamp(1.5)).toBe(1)
    expect(clamp(0.42)).toBe(0.42)

    const history = [0.2, 0.4, 0.6]
    expect(smoothScore(history, 0.8)).toBeCloseTo((0.2 + 0.4 + 0.6 + 0.8) / 4)
  })
})
