import type { ActionKind, DeviceCommand, VoiceMode } from './types'

export interface AppDescriptor {
  id: string
  name: string
  category: 'browser' | 'utility' | 'editor' | 'media' | 'system' | 'custom'
  command: string
  args?: string[]
  uriScheme?: string
  icon?: string
  voiceTriggers: string[]
  description: string
}

export const DEFAULT_APPS: AppDescriptor[] = [
  {
    id: 'microsoft-edge',
    name: 'Microsoft Edge',
    category: 'browser',
    command: 'msedge.exe',
    uriScheme: 'microsoft-edge:',
    voiceTriggers: ['microsoft edge', 'edge', 'browser', 'web browser'],
    description: 'Fast, secure browser for everyday web navigation',
  },
  {
    id: 'notepad',
    name: 'Notepad',
    category: 'editor',
    command: 'notepad.exe',
    voiceTriggers: ['notepad', 'notes', 'text editor'],
    description: 'Quick notes, drafting text, and scratchpad',
  },
  {
    id: 'calculator',
    name: 'Calculator',
    category: 'utility',
    command: 'calc.exe',
    uriScheme: 'calculator:',
    voiceTriggers: ['calculator', 'calc', 'calculate'],
    description: 'Standard, scientific, and programmer calculator',
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    category: 'editor',
    command: 'code.cmd',
    voiceTriggers: ['visual studio code', 'vscode', 'code editor', 'vs code'],
    description: 'Code editor for development and scripting',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    category: 'media',
    command: 'spotify.exe',
    uriScheme: 'spotify:',
    voiceTriggers: ['spotify', 'music', 'songs'],
    description: 'Music streaming and playback',
  },
  {
    id: 'downloads',
    name: 'Downloads',
    category: 'system',
    command: 'explorer.exe',
    args: ['shell:Downloads'],
    voiceTriggers: ['downloads', 'download folder', 'my downloads'],
    description: 'Open the user Downloads directory in File Explorer',
  },
  {
    id: 'settings',
    name: 'Windows Settings',
    category: 'system',
    command: 'explorer.exe',
    uriScheme: 'ms-settings:',
    args: ['ms-settings:'],
    voiceTriggers: ['settings', 'windows settings', 'control panel', 'system settings'],
    description: 'Windows system configuration and accessibility',
  },
]

const STORAGE_KEY = 'cuesta_custom_apps'

export function findAppById(id: string, customApps: AppDescriptor[] = []): AppDescriptor | undefined {
  return [...DEFAULT_APPS, ...customApps].find((app) => app.id === id)
}

export function isValidCustomExe(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim()
  if (/[;&|`$<>^"']/.test(trimmed)) return false
  // Reject UNC network paths (e.g. \\attacker\share\payload.exe) and relative paths
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) return false
  // Enforce absolute local drive letter path (e.g. C:\Tools\app.exe)
  if (!/^[a-zA-Z]:\\[^/:*?"<>|]+\.exe$/i.test(trimmed)) return false
  if (/\.exe\s+/i.test(trimmed)) return false
  if (/\s+\/[a-zA-Z]/.test(trimmed)) return false
  return true
}

export type ParsedIntent =
  | { type: 'open-app'; appId: string; appName: string }
  | { type: 'action'; action: ActionKind }
  | { type: 'device-cmd'; command: DeviceCommand; label: string }
  | { type: 'click-element'; targetName: string }
  | { type: 'voice-mode'; mode: VoiceMode }

const META_MODE_MAP: Array<{ triggers: string[]; intent: ParsedIntent }> = [
  { triggers: ['dictation mode', 'switch to dictation', 'typing mode', 'text mode'], intent: { type: 'voice-mode', mode: 'dictation' } },
  { triggers: ['control mode', 'device control', 'command mode', 'switch to control'], intent: { type: 'voice-mode', mode: 'control' } },
  { triggers: ['stop dictation', 'stop listening', 'mic off'], intent: { type: 'action', action: 'dictation' } },
  { triggers: ['pause gestures', 'pause all gestures', 'stop gestures', 'freeze gestures'], intent: { type: 'action', action: 'pause-gestures' } },
  { triggers: ['resume gestures', 'unpause gestures', 'enable gestures', 'gestures on'], intent: { type: 'action', action: 'pause-gestures' } },
]

const DEVICE_CMD_MAP: Array<{ triggers: string[]; command: DeviceCommand; label: string }> = [
  { triggers: ['switch window', 'next window', 'alt tab'], command: 'switch-window', label: 'Switch Window' },
  { triggers: ['close window', 'close app', 'close tab'], command: 'close-window', label: 'Close Window' },
  { triggers: ['minimize window', 'minimize'], command: 'minimize-window', label: 'Minimize Window' },
  { triggers: ['maximize window', 'maximize', 'full screen'], command: 'maximize-window', label: 'Maximize Window' },
  { triggers: ['snap left', 'window left', 'tile left'], command: 'snap-left', label: 'Snap Left' },
  { triggers: ['snap right', 'window right', 'tile right'], command: 'snap-right', label: 'Snap Right' },
  { triggers: ['show desktop', 'go to desktop'], command: 'show-desktop', label: 'Show Desktop' },
  { triggers: ['scroll left', 'pan left'], command: 'scroll-left', label: 'Scroll Left' },
  { triggers: ['scroll right', 'pan right'], command: 'scroll-right', label: 'Scroll Right' },
  { triggers: ['zoom in', 'bigger'], command: 'zoom-in', label: 'Zoom In' },
  { triggers: ['zoom out', 'smaller'], command: 'zoom-out', label: 'Zoom Out' },
  { triggers: ['volume up', 'louder', 'turn up volume'], command: 'volume-up', label: 'Volume Up' },
  { triggers: ['volume down', 'quieter', 'turn down volume'], command: 'volume-down', label: 'Volume Down' },
  { triggers: ['mute', 'unmute', 'mute audio', 'mute volume'], command: 'volume-mute', label: 'Toggle Mute' },
  { triggers: ['undo', 'undo that'], command: 'undo', label: 'Undo' },
  { triggers: ['copy that', 'copy text'], command: 'copy', label: 'Copy' },
  { triggers: ['paste that', 'paste text'], command: 'paste', label: 'Paste' },
  { triggers: ['press escape', 'escape', 'dismiss'], command: 'escape', label: 'Escape' },
]

const ACTION_VOICE_MAP: Array<{ triggers: string[]; action: ActionKind }> = [
  { triggers: ['left click', 'mouse click', 'click here', 'click'], action: 'click' },
  { triggers: ['double click'], action: 'double-click' },
  { triggers: ['right click', 'context menu'], action: 'right-click' },
  { triggers: ['cursor on', 'pointer on', 'head mouse on', 'head pointer'], action: 'toggle-pointer' },
  { triggers: ['cursor off', 'pointer off', 'head mouse off'], action: 'toggle-pointer' },
  { triggers: ['center cursor', 'recenter cursor', 'recenter', 'reset cursor'], action: 'recenter-pointer' },
  { triggers: ['scroll down', 'page down', 'scroll bottom'], action: 'scroll-down' },
  { triggers: ['scroll up', 'page up', 'scroll top'], action: 'scroll-up' },
  { triggers: ['select', 'enter', 'press enter', 'activate'], action: 'select' },
  { triggers: ['next', 'next element', 'tab', 'move next'], action: 'next' },
  { triggers: ['previous', 'prev', 'back element', 'shift tab'], action: 'previous' },
  { triggers: ['go back', 'back', 'return'], action: 'back' },
  { triggers: ['start dictation', 'dictation', 'toggle dictation'], action: 'dictation' },
]

/** Levenshtein edit distance for fuzzy voice matching (max 2 edits allowed). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function matchPhraseInList(cleaned: string, triggers: string[]): boolean {
  for (const trigger of triggers) {
    if (cleaned === trigger || cleaned.startsWith(`${trigger} `) || cleaned.endsWith(` ${trigger}`)) {
      return true
    }
    if (trigger.length >= 5 && Math.abs(cleaned.length - trigger.length) <= 3) {
      if (editDistance(cleaned, trigger) <= 2) return true
    }
  }
  return false
}

export function parseVoiceCommand(
  phrase: string,
  customApps: AppDescriptor[] = [],
  mode: VoiceMode = 'control'
): ParsedIntent | null {
  if (!phrase) return null
  const cleaned = phrase.toLowerCase().trim().replace(/[.,!?;:]/g, '')

  // 0. Always check meta safety / mode-switching phrases (work in BOTH Dictation & Control mode)
  for (const item of META_MODE_MAP) {
    if (item.triggers.some((t) => cleaned === t || (t.length >= 6 && editDistance(cleaned, t) <= 1))) {
      return item.intent
    }
  }

  // In pure Dictation Mode, prose never triggers mouse/window/app commands
  if (mode === 'dictation') return null

  // 1. On-screen UI Automation target click: "click Save", "press Submit", "tap Settings"
  //    Evaluated before bare "click" so "click the Save button" targets UI element "save"
  //    rather than triggering a blind left-click at the current cursor.
  for (const verb of ['click ', 'press ', 'tap ']) {
    if (cleaned.startsWith(verb)) {
      const targetName = cleaned.slice(verb.length).replace(/^the\s+/, '').replace(/\s+button$/, '').trim()
      if (targetName && !['here', 'now', 'left', 'right', 'double', 'enter', 'tab'].includes(targetName)) {
        return { type: 'click-element', targetName }
      }
    }
  }

  // 2. Standard switch/pointer actions
  for (const item of ACTION_VOICE_MAP) {
    if (matchPhraseInList(cleaned, item.triggers)) {
      return { type: 'action', action: item.action }
    }
  }

  // 3. Extended Device & Window Control commands
  for (const item of DEVICE_CMD_MAP) {
    if (matchPhraseInList(cleaned, item.triggers)) {
      return { type: 'device-cmd', command: item.command, label: item.label }
    }
  }

  // 4. Check for app opening commands — STRICTLY require "open/launch/start/run" prefix.
  const allApps = [...DEFAULT_APPS, ...customApps]
  const openPrefixes = ['open ', 'launch ', 'start ', 'run ']
  let target = cleaned
  let hasOpenIntent = false

  for (const prefix of openPrefixes) {
    if (cleaned.startsWith(prefix)) {
      target = cleaned.slice(prefix.length).trim()
      hasOpenIntent = true
      break
    }
  }

  // Without an open/launch/start/run prefix, never match an app by voice trigger alone
  if (!hasOpenIntent) return null

  target = target.replace(/ please$/, '').trim()

  for (const app of allApps) {
    for (const trigger of app.voiceTriggers) {
      if (target === trigger || target.includes(trigger)) {
        return { type: 'open-app', appId: app.id, appName: app.name }
      }
      if (trigger.length >= 4 && Math.abs(target.length - trigger.length) <= 3) {
        if (editDistance(target, trigger) <= 2) {
          return { type: 'open-app', appId: app.id, appName: app.name }
        }
      }
    }
  }

  return null
}

export function matchVoiceIntent(
  phrase: string,
  customApps: AppDescriptor[] = [],
  mode: VoiceMode = 'control'
): ParsedIntent | null {
  return parseVoiceCommand(phrase, customApps, mode)
}

export function loadCustomApps(): AppDescriptor[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomApps(apps: AppDescriptor[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps))
  } catch {}
}
