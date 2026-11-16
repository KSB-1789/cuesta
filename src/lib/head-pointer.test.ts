import { describe, expect, it } from 'vitest'
import { HeadPointerEngine } from './head-pointer'
import type { HeadPointerConfig } from './types'

const baseConfig: HeadPointerConfig = {
  enabled: true,
  sensitivity: 1.5,
  deadzone: 0.008,
  smoothing: 0.0, // zero smoothing for deterministic unit checks unless tested separately
  invertX: false,
  invertY: false,
  dwellClick: false,
  dwellMs: 800,
}

describe('HeadPointerEngine', () => {
  it('anchors first pose at screen center and holds steady inside deadzone', () => {
    const engine = new HeadPointerEngine()
    const first = engine.update(0.02, -0.01, baseConfig, 1920, 1080, 0)
    expect(first.nx).toBeCloseTo(0.5, 4)
    expect(first.ny).toBeCloseTo(0.5, 4)

    // Small tremor inside deadzone (0.004 < 0.008) keeps pointer motionless at center
    const tremor = engine.update(0.024, -0.014, baseConfig, 1920, 1080, 32)
    expect(tremor.nx).toBeCloseTo(0.5, 4)
    expect(tremor.ny).toBeCloseTo(0.5, 4)
  })

  it('maps head turns beyond deadzone across normalized screen bounds and clamps', () => {
    const engine = new HeadPointerEngine()
    engine.recenter(0, 0)

    // Looking right (negative camera yaw = mirror right in selfie space -> moves X right)
    const right = engine.update(-0.08, 0, baseConfig, 1920, 1080, 32)
    expect(right.nx).toBeGreaterThan(0.65)
    expect(right.ny).toBeCloseTo(0.5, 3)

    // Invert X flips direction cleanly
    const inverted = engine.update(-0.08, 0, { ...baseConfig, invertX: true }, 1920, 1080, 64)
    expect(inverted.nx).toBeLessThan(0.35)

    // Extreme head turn stays within [0.002, 0.998]
    const extreme = engine.update(-0.5, 0.5, baseConfig, 1920, 1080, 96)
    expect(extreme.nx).toBeLessThanOrEqual(0.998)
    expect(extreme.nx).toBeGreaterThanOrEqual(0.002)
    expect(extreme.ny).toBeLessThanOrEqual(0.998)
    expect(extreme.ny).toBeGreaterThanOrEqual(0.002)
  })

  it('applies exponential smoothing to suppress frame spikes', () => {
    const engine = new HeadPointerEngine()
    engine.recenter(0, 0)

    const smoothCfg: HeadPointerConfig = { ...baseConfig, smoothing: 0.7 }
    const step1 = engine.update(-0.09, 0, smoothCfg, 1920, 1080, 16)
    const step2 = engine.update(-0.09, 0, smoothCfg, 1920, 1080, 32)

    expect(step1.nx).toBeGreaterThan(0.5)
    expect(step2.nx).toBeGreaterThan(step1.nx) // monotonically converges toward target
  })

  it('triggers dwell click once steady over target and requires exit before refiring', () => {
    const engine = new HeadPointerEngine()
    engine.recenter(0, 0)

    const dwellCfg: HeadPointerConfig = { ...baseConfig, dwellClick: true, dwellMs: 500 }

    // Move cursor to activate dwell tracking (movement resets initial resting lock)
    const moveRes = engine.update(-0.05, 0, dwellCfg, 1000, 1000, 100)
    expect(moveRes.dwellTriggered).toBe(false)

    // Hold steady past dwellMs
    const midRes = engine.update(-0.05, 0, dwellCfg, 1000, 1000, 350)
    expect(midRes.dwellProgress).toBeGreaterThan(0.4)
    expect(midRes.dwellTriggered).toBe(false)

    const fireRes = engine.update(-0.05, 0, dwellCfg, 1000, 1000, 650)
    expect(fireRes.dwellTriggered).toBe(true)

    // Staying on same pixel must NOT immediately re-click endlessly
    const stayRes = engine.update(-0.05, 0, dwellCfg, 1000, 1000, 1400)
    expect(stayRes.dwellTriggered).toBe(false)

    // Moving away exits dwell lock so next hover can dwell-click again
    const exitRes = engine.update(0.05, 0, dwellCfg, 1000, 1000, 1450)
    expect(exitRes.dwellTriggered).toBe(false)
    const nextFire = engine.update(0.05, 0, dwellCfg, 1000, 1000, 2050)
    expect(nextFire.dwellTriggered).toBe(true)
  })
})
