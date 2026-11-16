import type { HeadPointerConfig } from './types'

export interface HeadPointerOutput {
  nx: number
  ny: number
  dwellProgress: number
  dwellTriggered: boolean
}

const MAX_HEAD_SPAN = 0.13 // ~23 degrees in normalized /pi yaw-pitch space

function applyDeadzoneAndCurve(delta: number, deadzone: number, sensitivity: number): number {
  const absDelta = Math.abs(delta)
  if (absDelta <= deadzone) return 0
  const effective = absDelta - deadzone
  const normalized = Math.min(1.5, effective / MAX_HEAD_SPAN)
  const curved = Math.pow(normalized, 1.3) * 0.5 * sensitivity
  return Math.sign(delta) * curved
}

function clampCoord(val: number): number {
  return Math.min(0.998, Math.max(0.002, val))
}

/**
 * Translates smoothed head yaw/pitch pose relative to a calibrated resting posture
 * into normalized [0..1] screen cursor coordinates with tremor deadzone and optional dwell click.
 */
export class HeadPointerEngine {
  private neutralYaw: number | null = null
  private neutralPitch: number | null = null
  private currentNx = 0.5
  private currentNy = 0.5

  private dwellAnchorX = 0.5
  private dwellAnchorY = 0.5
  private dwellSince: number | null = null
  private dwellWaitForExit = true // Require first intentional move before dwelling at screen center

  public recenter(yaw?: number, pitch?: number): void {
    this.neutralYaw = yaw ?? null
    this.neutralPitch = pitch ?? null
    this.currentNx = 0.5
    this.currentNy = 0.5
    this.dwellAnchorX = 0.5
    this.dwellAnchorY = 0.5
    this.dwellSince = null
    this.dwellWaitForExit = true
  }

  public update(
    yaw: number,
    pitch: number,
    config: HeadPointerConfig,
    viewportWidth = 1920,
    viewportHeight = 1080,
    now = performance.now(),
  ): HeadPointerOutput {
    if (this.neutralYaw === null || this.neutralPitch === null) {
      this.neutralYaw = yaw
      this.neutralPitch = pitch
      this.currentNx = 0.5
      this.currentNy = 0.5
      return { nx: 0.5, ny: 0.5, dwellProgress: 0, dwellTriggered: false }
    }

    // In MediaPipe transformation matrix: negative yaw = turning head right in mirror view.
    // Pitch upward decreases headPitch value (more negative -> cursor goes up / smaller ny).
    const rawDx = (this.neutralYaw - yaw) * (config.invertX ? -1 : 1)
    const rawDy = (pitch - this.neutralPitch) * (config.invertY ? -1 : 1)

    const targetNx = clampCoord(0.5 + applyDeadzoneAndCurve(rawDx, config.deadzone, config.sensitivity))
    const targetNy = clampCoord(0.5 + applyDeadzoneAndCurve(rawDy, config.deadzone * 0.85, config.sensitivity * 1.12))

    const alpha = Math.max(0.08, Math.min(1, 1 - config.smoothing))
    this.currentNx = clampCoord(this.currentNx + alpha * (targetNx - this.currentNx))
    this.currentNy = clampCoord(this.currentNy + alpha * (targetNy - this.currentNy))

    const dwellResult = this.evaluateDwell(config, viewportWidth, viewportHeight, now)
    return {
      nx: this.currentNx,
      ny: this.currentNy,
      dwellProgress: dwellResult.progress,
      dwellTriggered: dwellResult.triggered,
    }
  }

  private evaluateDwell(
    config: HeadPointerConfig,
    width: number,
    height: number,
    now: number,
  ): { progress: number; triggered: boolean } {
    if (!config.dwellClick) {
      this.dwellSince = null
      return { progress: 0, triggered: false }
    }

    const radiusPx = 24
    const distPx = Math.hypot(
      (this.currentNx - this.dwellAnchorX) * width,
      (this.currentNy - this.dwellAnchorY) * height,
    )

    if (this.dwellWaitForExit) {
      if (distPx > radiusPx * 1.4) {
        this.dwellWaitForExit = false
        this.dwellAnchorX = this.currentNx
        this.dwellAnchorY = this.currentNy
        this.dwellSince = now
      }
      return { progress: 0, triggered: false }
    }

    if (distPx > radiusPx) {
      this.dwellAnchorX = this.currentNx
      this.dwellAnchorY = this.currentNy
      this.dwellSince = now
      return { progress: 0, triggered: false }
    }

    if (this.dwellSince === null) {
      this.dwellSince = now
      return { progress: 0, triggered: false }
    }

    const elapsed = Math.max(0, now - this.dwellSince)
    const progress = Math.min(1, elapsed / Math.max(250, config.dwellMs))
    if (progress >= 1) {
      this.dwellWaitForExit = true
      this.dwellSince = null
      this.dwellAnchorX = this.currentNx
      this.dwellAnchorY = this.currentNy
      return { progress: 1, triggered: true }
    }
    return { progress, triggered: false }
  }
}
