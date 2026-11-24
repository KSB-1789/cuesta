import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DictationService } from './dictation'
import { formatDictatedTranscript } from './dictation-format'
import { loadSettings } from './storage'

describe('dictation service', () => {
  let originalDocument: any
  let originalWindow: any

  beforeEach(() => {
    originalDocument = (globalThis as any).document
    originalWindow = (globalThis as any).window
  })

  afterEach(() => {
    ;(globalThis as any).document = originalDocument
    ;(globalThis as any).window = originalWindow
  })

  it('subscribes and receives state payload notifications', () => {
    const service = new DictationService()
    const received: string[] = []

    const unsub = service.subscribe((payload) => {
      received.push(payload.state)
    })

    service.syncDesktopStatus({ state: 'listening', text: 'Testing' })
    expect(received).toEqual(['listening'])

    unsub()
    service.syncDesktopStatus({ state: 'off', text: '' })
    expect(received).toEqual(['listening']) // Unsubscribed, no new calls
  })

  it('inserts transcribed text into active input element', () => {
    const mockInput = {
      value: 'hello',
      selectionStart: 5,
      selectionEnd: 5,
      dispatchEvent: vi.fn(),
    }

    // Set mock DOM globals
    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = {
      activeElement: mockInput,
    }
    ;(globalThis as any).window = {
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }
    ;(globalThis as any).Event = function (name: string) {
      return { name }
    }

    const service = new DictationService()
    service.insertTranscribedText('world')

    expect(mockInput.value).toBe('hello world')
    expect(mockInput.selectionStart).toBe(11)
    expect(mockInput.dispatchEvent).toHaveBeenCalledTimes(2) // input and change
  })

  it('handles inputs where selectionStart throws DOMException without crashing', () => {
    const mockInput = {
      value: 'data',
      get selectionStart(): number {
        throw new Error('Selection not supported')
      },
      dispatchEvent: vi.fn(),
    }

    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = {
      activeElement: mockInput,
    }
    ;(globalThis as any).window = {
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }
    ;(globalThis as any).Event = function (name: string) {
      return { name }
    }

    const service = new DictationService()
    expect(() => {
      service.insertTranscribedText('appended')
    }).not.toThrow()
  })

  it('ignores empty whitespace text insertion', () => {
    const dispatchMock = vi.fn()
    ;(globalThis as any).window = {
      dispatchEvent: dispatchMock,
    }
    ;(globalThis as any).document = {
      activeElement: null,
    }

    const service = new DictationService()
    service.insertTranscribedText('   ')
    expect(dispatchMock).not.toHaveBeenCalled()

    service.insertTranscribedText('actual command')
    expect(dispatchMock).toHaveBeenCalled()
  })

  it('routes spoken voice commands to custom actionHandler without inserting into text fields', () => {
    const mockInput = {
      value: 'notes: ',
      selectionStart: 7,
      selectionEnd: 7,
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = { activeElement: mockInput }
    ;(globalThis as any).window = { dispatchEvent: vi.fn() }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }

    const handled: string[] = []
    const service = new DictationService()
    service.setActionHandler((action) => handled.push(action))

    service.insertTranscribedText('left click')
    expect(handled).toEqual(['click'])
    expect(mockInput.value).toBe('notes: ')
  })

  it('formats spoken punctuation, strips filler words, and keeps Dictation Mode free of accidental commands', async () => {
    expect(formatDictatedTranscript('uh hello comma world new line how are you question mark')).toBe(
      'Hello, world\nHow are you?'
    )

    const mockInput = {
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = { activeElement: mockInput }
    ;(globalThis as any).window = { dispatchEvent: vi.fn() }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }
    ;(globalThis as any).Event = function (name: string) {
      return { name }
    }

    const service = new DictationService()
    service.setAiConfig(false, '')
    service.setVoiceMode('dictation')

    await service.processFinalSpeech('open calculator period')
    expect(mockInput.value).toBe('Open calculator.')
  })

  it('inserts dictated text with correct spacing, newlines, and punctuation', async () => {
    const mockInput = {
      value: 'Header\n',
      selectionStart: 7,
      selectionEnd: 7,
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = { activeElement: mockInput }
    ;(globalThis as any).window = { dispatchEvent: vi.fn() }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }
    ;(globalThis as any).Event = function (name: string) {
      return { name }
    }

    const service = new DictationService()
    service.setAiConfig(false, '')
    service.setVoiceMode('dictation')

    await service.processFinalSpeech('second paragraph')
    expect(mockInput.value).toBe('Header\nSecond paragraph')

    // Appending after plain text adds exactly one separating space.
    mockInput.value = 'Hello'
    mockInput.selectionStart = 5
    mockInput.selectionEnd = 5
    service.insertTranscribedText('world')
    expect(mockInput.value).toBe('Hello world')

    // Punctuation is appended without an extra space.
    service.insertTranscribedText('.')
    expect(mockInput.value).toBe('Hello world.')
  })

  it('ignores a duplicate delivery of the same final utterance', async () => {
    const mockInput = {
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      dispatchEvent: vi.fn(),
    }
    ;(globalThis as any).HTMLInputElement = function () {}
    Object.setPrototypeOf(mockInput, (globalThis as any).HTMLInputElement.prototype)
    ;(globalThis as any).document = { activeElement: mockInput }
    ;(globalThis as any).window = { dispatchEvent: vi.fn() }
    ;(globalThis as any).CustomEvent = function (name: string, detail: any) {
      return { name, detail }
    }
    ;(globalThis as any).Event = function (name: string) {
      return { name }
    }

    const service = new DictationService()
    service.setAiConfig(false, '')
    service.setVoiceMode('dictation')

    const final = { state: 'listening', text: 'Hello there', rawText: 'Hello there', isFinal: true }
    service.syncDesktopStatus(final)
    service.syncDesktopStatus(final)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockInput.value).toBe('Hello there')
  })

  it('exposes the starting state and active fallback engine', () => {
    const service = new DictationService()
    const seen: Array<{ state: string; engine?: string }> = []
    service.subscribe((payload) => seen.push({ state: payload.state, engine: payload.engine }))

    service.syncDesktopStatus({
      state: 'starting',
      text: 'Loading speech engine…',
      engine: 'windows-speech',
    })

    expect(seen[0]).toEqual({ state: 'starting', engine: 'windows-speech' })
  })

  it('defaults to whisper neural speech provider and migrates legacy windows-speech in settings', () => {
    const service = new DictationService()
    // Service provider defaults to whisper
    expect((service as any).provider).toBe('whisper')

    // Storage migrates legacy windows-speech to whisper
    const originalLocalStorage = globalThis.localStorage
    const store: Record<string, string> = {
      'cuesta:settings:v1': JSON.stringify({ speechProvider: 'windows-speech' }),
    }
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val
      },
    }

    try {
      const settings = loadSettings()
      expect(settings.speechProvider).toBe('whisper')
    } finally {
      ;(globalThis as any).localStorage = originalLocalStorage
    }
  })
})
