import type { Settings, SwitchProfile } from './types'
import { computeFeatureWeights } from './signal'

const PROFILE_KEY = 'cuesta:profiles:v1'
const SETTINGS_KEY = 'cuesta:settings:v1'

const demoBaseline = Array(55).fill(0.02)
const demoPrototype = Array(55).fill(0.02)
demoPrototype[2] = 0.65 // browInnerUp
demoPrototype[3] = 0.55 // browOuterUpLeft
demoPrototype[4] = 0.55 // browOuterUpRight
const demoWeights = computeFeatureWeights(demoPrototype, demoBaseline, 'eyebrow')

export const DEFAULT_HEAD_POINTER: import('./types').HeadPointerConfig = {
  enabled: true,
  sensitivity: 1.4,
  deadzone: 0.008,
  smoothing: 0.55,
  invertX: false,
  invertY: false,
  dwellClick: false,
  dwellMs: 900,
}

export const demoProfile: SwitchProfile = {
  id: 'demo-eyebrow',
  name: 'Eyebrow raise → Click',
  signal: 'eyebrow',
  action: 'click',
  sensitivity: 0.54,
  holdMs: 160,
  cooldownMs: 650,
  prototype: demoPrototype,
  baseline: { mean: demoBaseline, std: Array(55).fill(0.04) },
  weights: demoWeights,
  repetitions: 3,
  trainedAt: '2026-11-06T17:00:00.000Z',
  demo: true,
  enabled: true,
}

export function loadProfiles(includeDemo = false): SwitchProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]') as SwitchProfile[]
    if (parsed.length) {
      return parsed.map((p) => ({ ...p, enabled: p.enabled ?? true }))
    }
  } catch {
    // Recover to the empty local state if a previous import was incomplete.
  }
  return includeDemo ? [demoProfile] : []
}

export function saveProfiles(profiles: SwitchProfile[]): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles))
}

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null
    const rawProvider = stored?.speechProvider as string | undefined
    const speechProvider: Settings['speechProvider'] =
      rawProvider === 'whisper' || rawProvider === 'windows-voice-typing' || rawProvider === 'windows-speech' || rawProvider === 'browser-speech'
        ? rawProvider === 'windows-speech' ? 'whisper' : rawProvider
        : 'whisper'
    return {
      activeProfileId: stored?.activeProfileId ?? null,
      scanIntervalMs: stored?.scanIntervalMs ?? 2400,
      browserSpeechFallback: stored?.browserSpeechFallback ?? false,
      reducedMotion: stored?.reducedMotion ?? false,
      hudMode: stored?.hudMode ?? 'studio',
      speechProvider,
      voiceMode: stored?.voiceMode === 'control' ? 'control' : 'dictation',
      ollamaEnabled: stored?.ollamaEnabled ?? true,
      ollamaModel: stored?.ollamaModel || 'qwen2.5:3b',
      headPointer: {
        ...DEFAULT_HEAD_POINTER,
        ...(stored?.headPointer ?? {}),
      },
      gesturesPaused: stored?.gesturesPaused ?? false,
      fingerSnapEnabled: stored?.fingerSnapEnabled ?? false,
    }
  } catch {
    return {
      activeProfileId: null,
      scanIntervalMs: 2400,
      browserSpeechFallback: false,
      reducedMotion: false,
      hudMode: 'studio',
      speechProvider: 'whisper',
      voiceMode: 'dictation',
      ollamaEnabled: true,
      ollamaModel: 'qwen2.5:3b',
      headPointer: { ...DEFAULT_HEAD_POINTER },
      gesturesPaused: false,
      fingerSnapEnabled: false,
    }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function exportProfiles(profiles: SwitchProfile[]): void {
  const payload = JSON.stringify({ app: 'cuesta', version: 1, exportedAt: new Date().toISOString(), profiles }, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = `cuesta-profiles-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(href)
}

export async function importProfiles(file: File): Promise<SwitchProfile[]> {
  const text = await file.text()
  const parsed = JSON.parse(text) as { profiles?: SwitchProfile[] } | SwitchProfile[]
  const profiles = Array.isArray(parsed) ? parsed : parsed.profiles
  if (!Array.isArray(profiles) || profiles.some((profile) => !profile.id || !profile.name || !profile.signal || !profile.action)) {
    throw new Error('That file does not look like a Cuesta profile export.')
  }
  return profiles
}
