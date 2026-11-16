export type Page = 'studio' | 'sandbox' | 'settings'

export type SensorMode = 'camera' | 'demo'

export type TrainingStep = 'setup' | 'baseline' | 'signal' | 'verify' | 'tune' | 'done'

export type VoiceMode = 'dictation' | 'control'

export type SignalKind =
  | 'eyebrow'
  | 'brow-furrow'
  | 'head-tilt'
  | 'head-turn'
  | 'nod'
  | 'mouth-open'
  | 'mouth-pucker'
  | 'smile'
  | 'jaw'
  | 'blink-hold'
  | 'wink-left'
  | 'wink-right'
  | 'squint'
  | 'cheek-puff'
  | 'finger-snap'

export type ActionKind =
  | 'click'
  | 'double-click'
  | 'right-click'
  | 'select'
  | 'scroll-down'
  | 'scroll-up'
  | 'next'
  | 'previous'
  | 'back'
  | 'key'
  | 'dictation'
  | 'toggle-pointer'
  | 'recenter-pointer'
  | 'pause-gestures'
  | 'launch-app'

export type DeviceCommand =
  | 'switch-window'
  | 'close-window'
  | 'minimize-window'
  | 'maximize-window'
  | 'snap-left'
  | 'snap-right'
  | 'show-desktop'
  | 'scroll-left'
  | 'scroll-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'volume-up'
  | 'volume-down'
  | 'volume-mute'
  | 'undo'
  | 'copy'
  | 'paste'
  | 'escape'

export interface HeadPointerConfig {
  enabled: boolean
  sensitivity: number // 0.5 to 3.0 multiplier
  deadzone: number // 0.004 to 0.035 normalized head angle tremor filter
  smoothing: number // 0.1 to 0.85 exponential smoothing
  invertX: boolean
  invertY: boolean
  dwellClick: boolean
  dwellMs: number // 400 to 2000ms
}

export interface HudStateSnapshot {
  cameraReady: boolean
  visionReady: boolean
  pointerEnabled: boolean
  dwellClick: boolean
  dwellProgress: number
  armedCount: number
  activeLabel: string
  liveScore: number
  threshold: number
  dictation: { state: string; text: string; isInterim?: boolean; volume?: number }
  notice: string
  gesturesPaused: boolean
  voiceMode: VoiceMode
  aiReady: boolean
}

export interface BaselineStats {
  mean: number[]
  std: number[]
}

export interface SwitchProfile {
  id: string
  name: string
  signal: SignalKind
  action: ActionKind
  key?: string
  targetAppId?: string
  sensitivity: number
  holdMs: number
  cooldownMs: number
  prototype: number[]
  baseline: BaselineStats
  weights?: number[]
  repetitions: number
  trainedAt: string
  demo?: boolean
  enabled: boolean
}

export interface Settings {
  activeProfileId: string | null
  scanIntervalMs: number
  browserSpeechFallback: boolean
  reducedMotion: boolean
  hudMode: 'studio' | 'hud'
  speechProvider: 'whisper' | 'windows-speech' | 'windows-voice-typing' | 'browser-speech'
  voiceMode: VoiceMode
  ollamaEnabled: boolean
  ollamaModel: string
  headPointer: HeadPointerConfig
  gesturesPaused: boolean
  fingerSnapEnabled: boolean
}
