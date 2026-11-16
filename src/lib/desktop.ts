import type { ActionKind, DeviceCommand, HudStateSnapshot, VoiceMode } from './types'

export type DesktopAction = ActionKind

export type HudCommand =
  | 'toggle-dictation'
  | 'toggle-pointer'
  | 'recenter-pointer'
  | 'toggle-pause'
  | 'toggle-voice-mode'
  | 'expand-studio'
  | 'trigger-active'

export interface DesktopDictationEvent {
  state: string
  text: string
  rawText?: string
  isCommand?: boolean
  isInterim?: boolean
  isFinal?: boolean
  isVolumeOnly?: boolean
  volume?: number
}

export interface OllamaStatus {
  available: boolean
  models: string[]
  selectedModel?: string
}

export interface UiElementSummary {
  name: string
  controlType: string
  x: number
  y: number
}

declare global {
  interface Window {
    cuestaDesktop?: {
      isDesktop: boolean
      runAction: (action: DesktopAction, key?: string, targetAppId?: string) => Promise<{ ok: boolean; reason?: string; state?: string }>
      runDeviceCommand: (command: DeviceCommand) => Promise<{ ok: boolean; reason?: string }>
      toggleDictation: (provider?: string) => Promise<{ ok: boolean; reason?: string; state?: string }>
      setDictationMode: (mode: VoiceMode) => void
      pasteExternalText: (text: string) => Promise<{ ok: boolean }>
      onDictationStatus: (callback: (payload: DesktopDictationEvent) => void) => (() => void) | void
      launchApp: (appId: string, customPath?: string) => Promise<{ ok: boolean; reason?: string; state?: string }>
      pickCustomExe: () => Promise<string | null>
      clickUiElement: (targetName: string) => Promise<{ ok: boolean; matchedName?: string; reason?: string }>
      listUiElements: () => Promise<{ ok: boolean; elements: UiElementSummary[] }>
      getForegroundInfo: () => Promise<{ ok: boolean; title: string; processName: string }>
      getOllamaStatus: () => Promise<OllamaStatus>
      cleanTranscriptWithAi: (text: string, model: string) => Promise<string | null>
      parseControlIntentWithAi: (phrase: string, model: string, appNames: string[]) => Promise<Record<string, any> | null>
      setWindowMode: (mode: 'studio' | 'hud') => Promise<{ ok: boolean; mode?: string }>
      onWindowModeChanged: (callback: (mode: 'studio' | 'hud') => void) => (() => void) | void
      syncHudState: (snapshot: HudStateSnapshot) => void
      onHudState: (callback: (snapshot: HudStateSnapshot) => void) => (() => void) | void
      sendHudCommand: (command: HudCommand) => void
      onHudCommand: (callback: (command: HudCommand) => void) => (() => void) | void
      moveHudBy: (dx: number, dy: number) => void
      moveCursorNorm: (nx: number, ny: number) => void
      moveCursor: (x: number, y: number) => void
      cursorClick: (kind?: 'click' | 'double-click' | 'right-click') => Promise<{ ok: boolean }>
      onShortcut: (callback: (payload: { chord: string }) => void) => (() => void) | void
    }
  }
}

export const desktopAvailable = () => Boolean(window.cuestaDesktop?.isDesktop)

export async function sendDesktopAction(action: DesktopAction, key?: string, targetAppId?: string): Promise<boolean> {
  if (!window.cuestaDesktop) return false
  const result = await window.cuestaDesktop.runAction(action, key, targetAppId)
  return result.ok
}

export async function launchDesktopApp(appId: string, customPath?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!window.cuestaDesktop) return { ok: false, reason: 'Desktop bridge unavailable.' }
  return window.cuestaDesktop.launchApp(appId, customPath)
}

export async function setDesktopWindowMode(mode: 'studio' | 'hud'): Promise<boolean> {
  if (!window.cuestaDesktop) return false
  const res = await window.cuestaDesktop.setWindowMode(mode)
  return res.ok
}

export async function fetchForegroundInfo(): Promise<{ title: string; processName: string }> {
  if (!window.cuestaDesktop?.getForegroundInfo) return { title: '', processName: '' }
  try {
    const res = await window.cuestaDesktop.getForegroundInfo()
    return { title: res.title || '', processName: res.processName || '' }
  } catch {
    return { title: '', processName: '' }
  }
}

/** Send DPI-independent normalized [0..1] screen coordinates — fire-and-forget */
export function sendCursorNorm(nx: number, ny: number): void {
  window.cuestaDesktop?.moveCursorNorm(nx, ny)
}

/** Send absolute screen coordinates for cursor movement — fire-and-forget */
export function sendCursorMove(x: number, y: number): void {
  window.cuestaDesktop?.moveCursor(x, y)
}

/** Trigger a physical OS click at the current screen position */
export async function sendCursorClick(kind: 'click' | 'double-click' | 'right-click' = 'click'): Promise<boolean> {
  if (!window.cuestaDesktop) return false
  const res = await window.cuestaDesktop.cursorClick(kind)
  return res.ok
}
