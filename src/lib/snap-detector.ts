/**
 * FingerSnapDetector — Acoustic transient detector using Web Audio API AnalyserNode.
 *
 * A finger snap produces a short (~30-80ms) broadband click with energy concentrated
 * in the 1–8 kHz range and a rapid amplitude attack followed by exponential decay.
 *
 * Detection algorithm:
 *   1. Measure RMS energy of 1–8 kHz band each frame (~10ms intervals at fftSize=1024, 48kHz).
 *   2. When RMS crosses the onset threshold (default 0.055), start tracking the transient.
 *   3. If the transient completes (RMS drops back below release threshold) within maxMs,
 *      and the peak was at least peakMultiplier × recent background level, emit a snap event.
 *   4. Enforce a cooldown of 400ms to prevent double-firing from echo.
 */

export type SnapCallback = () => void
export type SnapLevelCallback = (level: number) => void

interface SnapDetectorConfig {
  /** Minimum absolute RMS to begin tracking a transient. 0–1 scale. Default 0.055. */
  onsetThreshold?: number
  /** Fraction of onset threshold below which the transient ends. Default 0.4. */
  releaseRatio?: number
  /** Max allowed transient duration in ms. Beyond this it's speech, not a snap. Default 100. */
  maxMs?: number
  /** Min transient duration in ms. Below this it's electrical noise. Default 8. */
  minMs?: number
  /** Peak RMS must be this many × recent background to count as a snap. Default 3.0. */
  peakMultiplier?: number
  /** Cooldown in ms before the next snap can fire. Default 400. */
  cooldownMs?: number
  /** FFT size for frequency resolution. Default 1024. */
  fftSize?: number
}

export class FingerSnapDetector {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private rafId: number | null = null
  private callbacks: Set<SnapCallback> = new Set()
  private levelCallbacks: Set<SnapLevelCallback> = new Set()

  private readonly onsetThreshold: number
  private readonly releaseRatio: number
  private readonly maxMs: number
  private readonly minMs: number
  private readonly peakMultiplier: number
  private readonly cooldownMs: number
  private readonly fftSize: number

  // State machine
  private inTransient = false
  private transientStartMs = 0
  private transientPeak = 0
  private backgroundRms = 0.01 // Rolling mean of quiet-frame RMS
  private lastSnapMs = -Infinity

  constructor(config: SnapDetectorConfig = {}) {
    this.onsetThreshold = config.onsetThreshold ?? 0.055
    this.releaseRatio = config.releaseRatio ?? 0.4
    this.maxMs = config.maxMs ?? 100
    this.minMs = config.minMs ?? 8
    this.peakMultiplier = config.peakMultiplier ?? 3.0
    this.cooldownMs = config.cooldownMs ?? 400
    this.fftSize = config.fftSize ?? 1024
  }

  public subscribe(cb: SnapCallback): () => void {
    this.callbacks.add(cb)
    return () => this.callbacks.delete(cb)
  }

  public subscribeLevel(cb: SnapLevelCallback): () => void {
    this.levelCallbacks.add(cb)
    return () => this.levelCallbacks.delete(cb)
  }

  private emit(): void {
    this.callbacks.forEach((cb) => cb())
  }

  private emitLevel(level: number): void {
    this.levelCallbacks.forEach((cb) => cb(level))
  }

  /**
   * Start listening on the provided MediaStream (should be a mic stream).
   * If called with an existing stream while running, it restarts cleanly.
   */
  public async start(stream?: MediaStream): Promise<void> {
    this.stop()

    try {
      const micStream = stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }))
      this.stream = micStream

      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 })
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = this.fftSize
      this.analyser.smoothingTimeConstant = 0.0 // No smoothing — we need raw attack detection

      this.source = this.ctx.createMediaStreamSource(micStream)
      this.source.connect(this.analyser)

      this.loop()
    } catch {
      // Mic access denied or AudioContext unavailable — fail silently
      this.stop()
    }
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.source?.disconnect()
    this.source = null
    this.analyser = null
    this.ctx?.close().catch(() => undefined)
    this.ctx = null
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    this.inTransient = false
    this.backgroundRms = 0.01
  }

  private loop(): void {
    if (!this.analyser) return
    const bufLen = this.analyser.frequencyBinCount // fftSize / 2
    const freqData = new Float32Array(bufLen)

    const tick = () => {
      if (!this.analyser) return
      this.rafId = requestAnimationFrame(tick)
      this.analyser.getFloatFrequencyData(freqData) // dBFS values

      // Map 1–8 kHz bins: bin index = freq * fftSize / sampleRate
      const sr = this.ctx?.sampleRate ?? 48000
      const binHz = sr / this.fftSize
      const lo = Math.floor(1000 / binHz)
      const hi = Math.min(bufLen - 1, Math.ceil(8000 / binHz))

      // Compute RMS of [lo..hi] frequency slice (convert from dBFS to linear)
      let sumSq = 0
      let count = 0
      for (let i = lo; i <= hi; i++) {
        const linear = Math.pow(10, (freqData[i] ?? -160) / 20)
        sumSq += linear * linear
        count++
      }
      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0
      this.emitLevel(Math.min(1, rms / (this.onsetThreshold * 2.2)))

      const now = performance.now()

      if (!this.inTransient) {
        // Update rolling background estimate when quiet (slow EMA)
        if (rms < this.onsetThreshold * 0.5) {
          this.backgroundRms = this.backgroundRms * 0.995 + rms * 0.005
        }
        // Onset: energy spike above threshold
        if (rms >= this.onsetThreshold) {
          this.inTransient = true
          this.transientStartMs = now
          this.transientPeak = rms
        }
      } else {
        // Inside transient
        if (rms > this.transientPeak) this.transientPeak = rms

        const elapsed = now - this.transientStartMs
        const released = rms < this.onsetThreshold * this.releaseRatio

        if (released || elapsed > this.maxMs) {
          this.inTransient = false
          const duration = elapsed

          // Validate snap signature
          const longEnough = duration >= this.minMs
          const shortEnough = elapsed <= this.maxMs
          const loudEnough = this.transientPeak >= this.backgroundRms * this.peakMultiplier
          const cooledDown = now - this.lastSnapMs >= this.cooldownMs

          if (longEnough && shortEnough && loudEnough && cooledDown) {
            this.lastSnapMs = now
            this.emit()
          }

          this.transientPeak = 0
        }
      }
    }

    tick()
  }

  public get isRunning(): boolean {
    return this.rafId !== null
  }
}
