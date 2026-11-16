import type { ActionKind, SignalKind } from './types'

export const signalLabels: Record<SignalKind, string> = {
  eyebrow: 'Eyebrow raise',
  'brow-furrow': 'Brow furrow',
  'head-tilt': 'Head tilt',
  'head-turn': 'Head turn',
  nod: 'Nod',
  'mouth-open': 'Mouth open',
  'mouth-pucker': 'Lip pucker',
  smile: 'Smile',
  jaw: 'Jaw shift',
  'blink-hold': 'Both eyes blink',
  'wink-left': 'Left wink',
  'wink-right': 'Right wink',
  squint: 'Eye squint',
  'cheek-puff': 'Cheek puff',
  'finger-snap': 'Finger snap (Audio)',
}

export const actionLabels: Record<ActionKind, string> = {
  click: 'Left Mouse Click',
  'double-click': 'Double Click',
  'right-click': 'Right Click',
  select: 'Select / Enter',
  'scroll-down': 'Scroll Down',
  'scroll-up': 'Scroll Up',
  next: 'Next Element (Tab)',
  previous: 'Previous Element',
  back: 'Go Back',
  dictation: 'Toggle Dictation',
  'toggle-pointer': 'Toggle Head Cursor',
  'recenter-pointer': 'Recenter Cursor',
  'pause-gestures': 'Pause / Resume Gestures',
  'launch-app': 'Launch App',
  key: 'Key Press',
}

export const signalNotes: Record<SignalKind, string> = {
  eyebrow: 'Raise one or both eyebrows clearly upward',
  'brow-furrow': 'Knit / lower eyebrows sharply together',
  'head-tilt': 'Lean your head gently to one side',
  'head-turn': 'Turn your head left or right',
  nod: 'Nod once, at your comfortable pace',
  'mouth-open': 'Open your mouth intentionally',
  'mouth-pucker': 'Press lips forward cleanly (kiss shape)',
  smile: 'Use a clear, repeatable smile',
  jaw: 'Shift your jaw side to side',
  'blink-hold': 'Close BOTH eyes intentionally (ignores single winks)',
  'wink-left': 'Wink left eye only (ignores normal blinking)',
  'wink-right': 'Wink right eye only (ignores normal blinking)',
  squint: 'Squint both eyes slightly without blinking',
  'cheek-puff': 'Puff cheeks firmly for ~300ms (ignores light breathing)',
  'finger-snap': 'Snap your fingers near the microphone (no camera needed)',
}

export const SIGNAL_DEFAULTS: Record<SignalKind, { sensitivity: number; holdMs: number; cooldownMs: number }> = {
  eyebrow: { sensitivity: 0.54, holdMs: 140, cooldownMs: 550 },
  'brow-furrow': { sensitivity: 0.56, holdMs: 160, cooldownMs: 600 },
  'head-tilt': { sensitivity: 0.55, holdMs: 180, cooldownMs: 650 },
  'head-turn': { sensitivity: 0.55, holdMs: 180, cooldownMs: 650 },
  nod: { sensitivity: 0.55, holdMs: 160, cooldownMs: 650 },
  'mouth-open': { sensitivity: 0.56, holdMs: 160, cooldownMs: 600 },
  'mouth-pucker': { sensitivity: 0.58, holdMs: 180, cooldownMs: 600 },
  smile: { sensitivity: 0.56, holdMs: 180, cooldownMs: 600 },
  jaw: { sensitivity: 0.58, holdMs: 180, cooldownMs: 600 },
  'blink-hold': { sensitivity: 0.60, holdMs: 280, cooldownMs: 750 },
  'wink-left': { sensitivity: 0.58, holdMs: 180, cooldownMs: 650 },
  'wink-right': { sensitivity: 0.58, holdMs: 180, cooldownMs: 650 },
  squint: { sensitivity: 0.58, holdMs: 220, cooldownMs: 650 },
  'cheek-puff': { sensitivity: 0.64, holdMs: 300, cooldownMs: 750 },
  'finger-snap': { sensitivity: 0.50, holdMs: 20, cooldownMs: 450 },
}

export async function requestCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.')
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
}

export function stopCameraStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

export function simulatedFeatureFrame(intensity = 0.5, targetIndices: number[] = [2, 3]): number[] {
  const features = Array.from({ length: 55 }, (_, index) => 0.02 + ((index * 17) % 7) / 500)
  for (const idx of targetIndices) {
    if (idx < 55) {
      features[idx] = Math.min(1.0, 0.04 + intensity * 0.8)
    }
  }
  return features
}

export function cameraStatusCopy(): string {
  return 'Camera frames stay in memory on this device. Cuesta never stores or uploads video.'
}
