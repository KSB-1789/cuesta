import { desktopAvailable, sendDesktopAction, launchDesktopApp, type DesktopDictationEvent } from './desktop'
import { DEFAULT_APPS, loadCustomApps, parseVoiceCommand, type ParsedIntent } from './app-registry'
import { formatDictatedTranscript, refineTranscriptWithAi, resolveControlIntentWithAi } from './dictation-format'
import type { ActionKind, Settings, VoiceMode } from './types'

export type DictationState = 'off' | 'starting' | 'listening' | 'transcribing' | 'done' | 'error'

export interface DictationPayload {
  state: DictationState
  text: string
  isInterim?: boolean
  isFinal?: boolean
  volume?: number
  engine?: string
}

type DictationCallback = (payload: DictationPayload) => void
type VoiceActionHandler = (action: ActionKind) => void
type VoiceModeHandler = (mode: VoiceMode) => void

export class DictationService {
  private recognition: any = null
  private isListening = false
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private micStream: MediaStream | null = null
  private animFrameId: number | null = null
  private callbacks: Set<DictationCallback> = new Set()
  private actionHandler: VoiceActionHandler | null = null
  private voiceModeHandler: VoiceModeHandler | null = null
  private provider: Settings['speechProvider'] = 'whisper'
  private voiceMode: VoiceMode = 'dictation'
  private aiConfig = { enabled: true, model: 'qwen2.5:3b' }
  private currentVolume = 0
  private lastText = ''
  private pendingAnalysis = false
  private engine = 'whisper'
  private lastState: DictationState = 'off'
  private lastFinal = { text: '', at: 0 }

  constructor() {
    this.initRecognition()
  }

  public setProvider(provider: Settings['speechProvider']): void {
    this.provider = provider
  }

  public setVoiceMode(mode: VoiceMode): void {
    this.voiceMode = mode
    if (typeof window !== 'undefined') {
      window.cuestaDesktop?.setDictationMode?.(mode)
    }
  }

  public getVoiceMode(): VoiceMode {
    return this.voiceMode
  }

  public setAiConfig(enabled: boolean, model: string): void {
    this.aiConfig = { enabled, model: model || 'qwen2.5:3b' }
  }

  public setActionHandler(handler: VoiceActionHandler | null): void {
    this.actionHandler = handler
  }

  public setVoiceModeHandler(handler: VoiceModeHandler | null): void {
    this.voiceModeHandler = handler
  }

  private initRecognition() {
    if (typeof window === 'undefined') return
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    try {
      this.recognition = new SpeechRecognition()
      this.recognition.continuous = true
      this.recognition.interimResults = true
      this.recognition.lang = 'en-US'

      this.recognition.onstart = () => {
        this.isListening = true
        this.notify({ state: 'listening', text: 'Listening… speak now.', isFinal: false, volume: 0 })
      }

      this.recognition.onresult = (event: any) => {
        let interim = ''
        let final = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript
          } else {
            interim += event.results[i][0].transcript
          }
        }

        const transcript = (final || interim).trim()
        if (transcript) {
          this.lastText = transcript
          this.notify({
            state: 'listening',
            text: transcript,
            isInterim: !final,
            isFinal: Boolean(final),
            volume: this.currentVolume,
          })
          if (final) {
            void this.processFinalSpeech(final, true)
          }
        }
      }

      this.recognition.onerror = (event: any) => {
        this.notify({ state: 'error', text: `Speech notice: ${event.error}` })
        this.stop()
      }

      this.recognition.onend = () => {
        this.isListening = false
        this.stopAudioAnalysis()
        this.notify({ state: 'off', text: '' })
      }
    } catch {
      this.recognition = null
    }
  }

  private startAudioAnalysis() {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
    this.pendingAnalysis = true
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!this.isListening || !this.pendingAnalysis) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        this.micStream = stream
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        const source = this.audioContext.createMediaStreamSource(stream)
        this.analyser = this.audioContext.createAnalyser()
        this.analyser.fftSize = 256
        source.connect(this.analyser)

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
        const checkVolume = () => {
          if (!this.analyser) return
          this.analyser.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((acc, v) => acc + v, 0) / dataArray.length
          this.currentVolume = Math.min(100, Math.round((avg / 128) * 100))
          this.animFrameId = requestAnimationFrame(checkVolume)
        }
        checkVolume()
      })
      .catch(() => {
        this.pendingAnalysis = false
      })
  }

  private stopAudioAnalysis() {
    this.pendingAnalysis = false
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId)
    this.animFrameId = null
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
    this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    this.analyser = null
    this.currentVolume = 0
  }

  public subscribe(callback: DictationCallback): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  private notify(payload: DictationPayload) {
    this.lastState = payload.state
    const full = payload.engine ? payload : { ...payload, engine: this.engine }
    this.callbacks.forEach((cb) => cb(full))
  }

  public getEngine(): string {
    return this.engine
  }

  public async toggle(): Promise<{ ok: boolean; state: DictationState }> {
    if (this.isListening) {
      this.stop()
      return { ok: true, state: 'off' }
    }
    const res = await this.start()
    return { ok: res, state: res ? 'listening' : 'error' }
  }

  public syncDesktopStatus(payload: DesktopDictationEvent, handleRawText = true) {
    if (payload.engine) this.engine = payload.engine

    // Keep listening active across finalized utterances in continuous mode; only
    // 'off' and 'error' end the active session.
    if (payload.state === 'off' || payload.state === 'error') {
      this.isListening = false
    } else if (payload.state === 'listening' || payload.state === 'starting') {
      this.isListening = true
    }

    if (payload.isVolumeOnly) {
      this.currentVolume = payload.volume ?? 0
      this.notify({
        state: this.lastState === 'starting' ? 'starting' : 'listening',
        text: this.lastText,
        isInterim: true,
        volume: this.currentVolume,
      })
      return
    }

    if (payload.isFinal && payload.rawText && handleRawText) {
      const key = payload.rawText.toLowerCase()
      const now = Date.now()
      // Guard against a duplicated delivery of the same utterance.
      if (key === this.lastFinal.text && now - this.lastFinal.at < 500) return
      this.lastFinal = { text: key, at: now }
      this.lastText = payload.rawText
      void this.processFinalSpeech(payload.rawText, true, Boolean(payload.isCommand))
      return
    }

    this.lastText = payload.text || ''
    this.notify({
      state: payload.state as DictationState,
      text: this.lastText,
      isInterim: payload.isInterim,
      isFinal: payload.isFinal,
      volume: payload.volume ?? this.currentVolume,
    })
  }

  public async start(): Promise<boolean> {
    if (desktopAvailable() && window.cuestaDesktop && this.provider !== 'browser-speech') {
      window.cuestaDesktop.setDictationMode?.(this.voiceMode)
      const res = await window.cuestaDesktop.toggleDictation(this.provider)
      if (res.ok) {
        if (res.state === 'starting') {
          this.isListening = true
          this.lastText = 'Loading speech engine…'
          this.notify({ state: 'starting', text: this.lastText, volume: 0 })
        } else if (res.state === 'listening') {
          this.isListening = true
          this.lastText = this.voiceMode === 'control' ? 'Control Mode listening…' : 'Dictation listening…'
          this.notify({ state: 'listening', text: this.lastText, volume: 0 })
        }
      } else if (res.reason) {
        this.notify({ state: 'error', text: res.reason })
      }
      return res.ok
    }

    if (!this.recognition) {
      this.notify({
        state: 'error',
        text: 'Use Windows Desktop app (Ctrl+Win) or Chromium/Edge for live speech recognition.',
      })
      return false
    }

    try {
      this.isListening = true
      this.recognition.start()
      this.startAudioAnalysis()
      return true
    } catch {
      this.isListening = false
      return false
    }
  }

  public stop(): void {
    if (desktopAvailable() && window.cuestaDesktop && this.provider !== 'browser-speech') {
      if (this.isListening) {
        void window.cuestaDesktop.toggleDictation(this.provider)
      }
    }
    try {
      this.recognition?.stop()
    } catch {}
    this.stopAudioAnalysis()
    this.isListening = false
    this.lastText = ''
    this.notify({ state: 'off', text: '' })
  }

  public handleEngineStatus(status: { engine?: string }): void {
    if (status?.engine) this.engine = status.engine
  }

  private executeIntent(intent: ParsedIntent, rawPhrase: string): void {
    const customApps = loadCustomApps()

    if (intent.type === 'voice-mode') {
      this.setVoiceMode(intent.mode)
      this.voiceModeHandler?.(intent.mode)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cuesta:voice:command', { detail: { text: rawPhrase, intent } }))
      }
      this.notify({
        state: this.isListening ? 'listening' : 'done',
        text: intent.mode === 'control' ? 'Switched to Device Control Mode' : 'Switched to Dictation Mode',
        isFinal: true,
      })
      return
    }

    if (intent.type === 'action') {
      if (this.actionHandler) {
        this.actionHandler(intent.action)
      } else {
        void sendDesktopAction(intent.action)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('cuesta:action:triggered', { detail: { action: intent.action, source: 'voice' } })
          )
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cuesta:voice:command', { detail: { text: rawPhrase, intent } }))
      }
      this.notify({
        state: this.isListening ? 'listening' : 'done',
        text: `Command: ${rawPhrase}`,
        isFinal: true,
      })
      return
    }

    if (intent.type === 'device-cmd') {
      void window.cuestaDesktop?.runDeviceCommand?.(intent.command)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cuesta:voice:command', { detail: { text: rawPhrase, intent } }))
        window.dispatchEvent(
          new CustomEvent('cuesta:action:triggered', { detail: { action: intent.label, source: 'voice' } })
        )
      }
      this.notify({
        state: this.isListening ? 'listening' : 'done',
        text: `Device: ${intent.label}`,
        isFinal: true,
      })
      return
    }

    if (intent.type === 'click-element') {
      void window.cuestaDesktop?.clickUiElement?.(intent.targetName).then((res) => {
        const msg = res?.ok
          ? `Clicked "${res.matchedName || intent.targetName}"`
          : res?.reason || `Target "${intent.targetName}" not visible`
        this.notify({
          state: this.isListening ? 'listening' : 'done',
          text: msg,
          isFinal: true,
        })
      })
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cuesta:voice:command', { detail: { text: rawPhrase, intent } }))
      }
      return
    }

    if (intent.type === 'open-app') {
      const custom = customApps.find((a) => a.id === intent.appId)
      void launchDesktopApp(intent.appId, custom?.category === 'custom' ? custom.command : undefined)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cuesta:voice:command', { detail: { text: rawPhrase, intent } }))
      }
      this.notify({
        state: this.isListening ? 'listening' : 'done',
        text: `Launched: ${intent.appName}`,
        isFinal: true,
      })
    }
  }

  /**
   * Async speech processing pipeline for live speech results:
   * handles Dictation Mode vs Device Control Mode separation + optional local Ollama refinement.
   */
  public async processFinalSpeech(
    text: string,
    allowExternalPaste = false,
    forceCommandCheck = false
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    const effectiveMode: VoiceMode = forceCommandCheck ? 'control' : this.voiceMode
    try {
      const customApps = loadCustomApps()
      const intent = parseVoiceCommand(trimmed, customApps, effectiveMode)
      if (intent) {
        this.executeIntent(intent, trimmed)
        return
      }

      if (effectiveMode === 'control') {
        if (this.aiConfig.enabled) {
          const allNames = [...DEFAULT_APPS, ...customApps].map((a) => a.name)
          const aiIntent = await resolveControlIntentWithAi(trimmed, {
            enabled: this.aiConfig.enabled,
            model: this.aiConfig.model,
            appNames: allNames,
          })
          if (aiIntent) {
            this.executeIntent(aiIntent, trimmed)
            return
          }
        }
        this.notify({
          state: this.isListening ? 'listening' : 'done',
          text: `Control heard: "${trimmed}"`,
          isFinal: true,
        })
        return
      }

      if (/^(scratch that|undo that|delete last)$/i.test(trimmed)) {
        void window.cuestaDesktop?.runDeviceCommand?.('undo')
        this.notify({
          state: this.isListening ? 'listening' : 'done',
          text: 'Undid last phrase',
          isFinal: true,
        })
        return
      }

      const refined = await refineTranscriptWithAi(trimmed, this.aiConfig)
      this.insertPlainText(refined || formatDictatedTranscript(trimmed), allowExternalPaste)
    } catch {
      this.insertPlainText(formatDictatedTranscript(trimmed), allowExternalPaste)
    }
  }

  /**
   * Synchronous insertion entrypoint preserved for direct programmatic/test calls.
   */
  public insertTranscribedText(text: string, allowExternalPaste = false): void {
    const trimmed = text.trim()
    if (!trimmed) return

    try {
      const customApps = loadCustomApps()
      const intent = parseVoiceCommand(trimmed, customApps, 'control')
      if (intent) {
        this.executeIntent(intent, trimmed)
        return
      }
    } catch {
      // Fallback to text insertion
    }

    this.insertPlainText(trimmed, allowExternalPaste)
  }

  private insertPlainText(trimmed: string, allowExternalPaste: boolean): void {
    if (!trimmed) return
    const active = typeof document !== 'undefined' ? document.activeElement : null
    const isTextInput =
      active &&
      ((typeof HTMLInputElement !== 'undefined' && active instanceof HTMLInputElement) ||
        (typeof HTMLTextAreaElement !== 'undefined' && active instanceof HTMLTextAreaElement))

    if (isTextInput && active) {
      const val = String((active as any).value ?? '')
      let start = val.length
      let end = val.length
      try {
        start = (active as any).selectionStart ?? val.length
        end = (active as any).selectionEnd ?? val.length
      } catch {}

      const before = val.slice(0, start)
      // Never glue words together, and never add a space before punctuation or a new line.
      const needsSpace = start > 0 && !/\s$/.test(before) && !/^[\s.,!?;:]/.test(trimmed)
      const insert = needsSpace ? ` ${trimmed}` : trimmed
      ;(active as any).value = before + insert + val.slice(end)
      try {
        ;(active as any).selectionStart = (active as any).selectionEnd = start + insert.length
      } catch {}
      active.dispatchEvent(new Event('input', { bubbles: true }))
      active.dispatchEvent(new Event('change', { bubbles: true }))
      this.notify({ state: this.isListening ? 'listening' : 'done', text: trimmed, isFinal: true })
    } else if (allowExternalPaste && typeof window !== 'undefined' && desktopAvailable() && window.cuestaDesktop) {
      const payload = /[\s\n]$/.test(trimmed) ? trimmed : `${trimmed} `
      void window.cuestaDesktop.pasteExternalText(payload)
      this.notify({ state: this.isListening ? 'listening' : 'done', text: `Typed: ${trimmed}`, isFinal: true })
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cuesta:dictation:inserted', { detail: { text: trimmed } })
      )
    }
  }
}

export const dictationService = new DictationService()
