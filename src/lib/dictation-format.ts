import { DEFAULT_APPS, loadCustomApps, type ParsedIntent } from './app-registry'
import type { DeviceCommand } from './types'

const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\b(new line|next line)\b/gi, '\n'],
  [/\bquestion mark\b/gi, '?'],
  [/\b(exclamation mark|exclamation point)\b/gi, '!'],
  [/\b(period|full stop)\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bcolon\b/gi, ':'],
  [/\bsemicolon\b/gi, ';'],
]

const VALID_DEVICE_COMMANDS: Set<DeviceCommand> = new Set([
  'switch-window',
  'close-window',
  'minimize-window',
  'maximize-window',
  'snap-left',
  'snap-right',
  'show-desktop',
  'scroll-left',
  'scroll-right',
  'zoom-in',
  'zoom-out',
  'volume-up',
  'volume-down',
  'volume-mute',
  'undo',
  'copy',
  'paste',
  'escape',
])

/**
 * Deterministic low-latency cleanup for continuous speech transcripts:
 * applies spoken punctuation, removes filler disfluencies, tightens spacing,
 * and ensures sentence-start capitalization.
 */
export function formatDictatedTranscript(raw: string): string {
  let text = raw.trim()
  if (!text) return ''

  // Remove standalone hesitation fillers ("uh", "um", "er") without hurting words
  text = text.replace(/\b(uh+|um+|erm+)\b[\s,]*/gi, ' ')

  for (const [pattern, symbol] of SPOKEN_PUNCTUATION) {
    text = text.replace(pattern, symbol)
  }

  // Collapse runs of spaces/tabs while preserving explicit newlines
  text = text.replace(/[ \t]{2,}/g, ' ')
  text = text.replace(/\s+([.,?!:;])/g, '$1')
  text = text.replace(/([.,?!:;])([^\s\n.,?!:;])/g, '$1 $2')
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
  text = text.trim()

  if (!text) return ''

  // Capitalize first letter and characters after sentence-ending punctuation
  text = text.charAt(0).toUpperCase() + text.slice(1)
  text = text.replace(/([.?!\n]\s*)([a-z])/g, (_, prefix: string, ch: string) => `${prefix}${ch.toUpperCase()}`)

  return text
}

/**
 * Optionally refines a dictated utterance using local Ollama (when enabled and reachable)
 * before falling back to deterministic formatting. Never drops user content on timeout.
 */
export async function refineTranscriptWithAi(
  raw: string,
  options: { enabled: boolean; model: string }
): Promise<string> {
  const baseline = formatDictatedTranscript(raw)
  if (!baseline) return ''
  if (!options.enabled || baseline.split(/\s+/).length < 3) return baseline

  try {
    const clean = await window.cuestaDesktop?.cleanTranscriptWithAi?.(baseline, options.model)
    if (clean && clean.trim()) {
      return clean.trim()
    }
  } catch {
    // Silent fallback to deterministic formatter when Ollama is offline
  }
  return baseline
}

export async function resolveControlIntentWithAi(
  phrase: string,
  options: { enabled: boolean; model: string; appNames: string[] }
): Promise<ParsedIntent | null> {
  if (!options.enabled || !phrase.trim()) return null
  try {
    const res = await window.cuestaDesktop?.parseControlIntentWithAi?.(
      phrase,
      options.model,
      options.appNames
    )
    if (!res || typeof res !== 'object') return null

    if (res.type === 'device-cmd' && VALID_DEVICE_COMMANDS.has(res.command as DeviceCommand)) {
      return {
        type: 'device-cmd',
        command: res.command as DeviceCommand,
        label: res.label || res.command,
      }
    }
    if (res.type === 'click-element' && typeof res.targetName === 'string' && res.targetName.trim()) {
      return { type: 'click-element', targetName: res.targetName.trim() }
    }
    if (res.type === 'open-app') {
      const allApps = [...DEFAULT_APPS, ...loadCustomApps()]
      const matched = allApps.find(
        (a) =>
          a.id === res.appId ||
          a.name.toLowerCase() === String(res.appName || '').toLowerCase() ||
          a.voiceTriggers.includes(String(res.appName || '').toLowerCase())
      )
      if (matched) {
        return { type: 'open-app', appId: matched.id, appName: matched.name }
      }
    }
    if (res.type === 'action' && typeof res.action === 'string') {
      return { type: 'action', action: res.action as any }
    }
  } catch {
    // Fallback gracefully
  }
  return null
}
