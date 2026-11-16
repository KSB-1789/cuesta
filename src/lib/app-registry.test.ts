import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPS,
  findAppById,
  isValidCustomExe,
  matchVoiceIntent,
  parseVoiceCommand,
} from './app-registry'

describe('app-registry', () => {
  it('includes default allowlisted Windows applications', () => {
    expect(DEFAULT_APPS.length).toBeGreaterThanOrEqual(6)
    const edge = findAppById('microsoft-edge')
    expect(edge).toBeDefined()
    expect(edge?.name).toBe('Microsoft Edge')

    const notepad = findAppById('notepad')
    expect(notepad).toBeDefined()
    expect(notepad?.command).toBe('notepad.exe')

    const calc = findAppById('calculator')
    expect(calc).toBeDefined()

    const settings = findAppById('settings')
    expect(settings).toBeDefined()
  })

  it('parses voice phrases into app launch intents', () => {
    const edgeIntent = parseVoiceCommand('open Microsoft Edge')
    expect(edgeIntent).toEqual({
      type: 'open-app',
      appId: 'microsoft-edge',
      appName: 'Microsoft Edge',
    })

    const notepadIntent = parseVoiceCommand('launch notepad please')
    expect(notepadIntent).toEqual({
      type: 'open-app',
      appId: 'notepad',
      appName: 'Notepad',
    })

    const calcIntent = parseVoiceCommand('open calculator')
    expect(calcIntent?.type).toBe('open-app')

    const unknownIntent = parseVoiceCommand('delete system32')
    expect(unknownIntent).toBeNull()

    // Strict prefix enforcement: bare app names never launch apps without "open/launch/start/run"
    expect(parseVoiceCommand('calculator', [], 'control')).toBeNull()
    expect(parseVoiceCommand('notepad', [], 'control')).toBeNull()
    expect(parseVoiceCommand('open calculator', [], 'control')?.type).toBe('open-app')
  })

  it('separates Dictation Mode from Device Control Mode and parses window/element commands', () => {
    // In Dictation Mode, commands and app launches are ignored except safe meta toggles
    expect(parseVoiceCommand('open calculator', [], 'dictation')).toBeNull()
    expect(parseVoiceCommand('left click', [], 'dictation')).toBeNull()
    expect(parseVoiceCommand('pause gestures', [], 'dictation')).toEqual({
      type: 'action',
      action: 'pause-gestures',
    })
    expect(parseVoiceCommand('control mode', [], 'dictation')).toEqual({
      type: 'voice-mode',
      mode: 'control',
    })

    // In Control Mode, window management & UI element click targets parse cleanly
    expect(parseVoiceCommand('snap left', [], 'control')).toEqual({
      type: 'device-cmd',
      command: 'snap-left',
      label: 'Snap Left',
    })
    expect(parseVoiceCommand('switch window', [], 'control')).toEqual({
      type: 'device-cmd',
      command: 'switch-window',
      label: 'Switch Window',
    })
    expect(parseVoiceCommand('click the Save button', [], 'control')).toEqual({
      type: 'click-element',
      targetName: 'save',
    })
  })

  it('parses voice navigation commands into action intents', () => {
    expect(parseVoiceCommand('scroll down')).toEqual({
      type: 'action',
      action: 'scroll-down',
    })
    expect(parseVoiceCommand('select')).toEqual({
      type: 'action',
      action: 'select',
    })
    expect(parseVoiceCommand('start dictation')).toEqual({
      type: 'action',
      action: 'dictation',
    })
    expect(parseVoiceCommand('left click')).toEqual({
      type: 'action',
      action: 'click',
    })
    expect(parseVoiceCommand('cursor on')).toEqual({
      type: 'action',
      action: 'toggle-pointer',
    })
    expect(parseVoiceCommand('center cursor')).toEqual({
      type: 'action',
      action: 'recenter-pointer',
    })
  })

  it('validates custom exe paths safely without command injection or UNC NTLM leaks', () => {
    expect(isValidCustomExe('C:\\Program Files\\App\\tool.exe')).toBe(true)
    expect(isValidCustomExe('D:\\Games\\Game.EXE')).toBe(true)
    expect(isValidCustomExe('C:\\Windows\\System32\\notepad.exe')).toBe(true)

    // Security rejections: UNC remote paths (NTLM leak / remote code execution)
    expect(isValidCustomExe('\\\\attacker.com\\share\\payload.exe')).toBe(false)
    expect(isValidCustomExe('//192.168.1.100/malware.exe')).toBe(false)
    expect(isValidCustomExe('notepad.exe')).toBe(false) // Relative path rejected

    // Security rejections: Command injection & flags
    expect(isValidCustomExe('C:\\Windows\\System32\\cmd.exe /c calc.exe')).toBe(false)
    expect(isValidCustomExe('C:\\app.exe; rm -rf /')).toBe(false)
    expect(isValidCustomExe('C:\\app.exe & notepad.exe')).toBe(false)
    expect(isValidCustomExe('C:\\script.bat')).toBe(false)
    expect(isValidCustomExe('C:\\payload.ps1')).toBe(false)
    expect(isValidCustomExe('')).toBe(false)
  })
})
