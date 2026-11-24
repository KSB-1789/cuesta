import React, { useEffect, useState } from 'react'
import {
  ExternalLink,
  Plus,
  Trash2,
  Download,
  Upload,
  RotateCcw,
  Sliders,
  Keyboard,
  FolderOpen,
  AppWindow,
  Mic,
  RefreshCw,
} from 'lucide-react'
import type { Settings, SwitchProfile } from '../lib/types'
import {
  DEFAULT_APPS,
  isValidCustomExe,
  loadCustomApps,
  saveCustomApps,
  type AppDescriptor,
} from '../lib/app-registry'
import { desktopAvailable, launchDesktopApp, type SpeechEngineStatus } from '../lib/desktop'

interface SettingsPageProps {
  settings: Settings
  profiles: SwitchProfile[]
  onUpdateSettings: (settings: Settings) => void
  onExportProfiles: () => void
  onImportProfiles: (file: File) => void
  onResetProfiles: () => void
  onNotice: (msg: string) => void
}

export function SettingsPage({
  settings,
  profiles,
  onUpdateSettings,
  onExportProfiles,
  onImportProfiles,
  onResetProfiles,
  onNotice,
}: SettingsPageProps) {
  const [customApps, setCustomApps] = useState<AppDescriptor[]>(() => loadCustomApps())
  const [newAppName, setNewAppName] = useState('')
  const [newAppPath, setNewAppPath] = useState('')
  const [newAppTriggers, setNewAppTriggers] = useState('')
  const [addError, setAddError] = useState('')
  const [speech, setSpeech] = useState<SpeechEngineStatus | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    if (!desktopAvailable()) return
    let cancelled = false

    const read = () => {
      setProbing(true)
      window.cuestaDesktop
        ?.getSpeechStatus?.()
        .then((status) => {
          if (!cancelled) setSpeech(status)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setProbing(false)
        })
    }

    read()
    const unsub = window.cuestaDesktop?.onSpeechStatus((status) => {
      setSpeech((prev) => ({ ...(prev ?? status), ...status }))
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  const engineName =
    speech?.engine === 'windows-speech'
      ? 'Windows Speech'
      : speech?.engine === 'windows-voice-typing'
      ? 'Windows Voice Typing'
      : 'Whisper Neural'
  const engineStateClass =
    speech?.state === 'error'
      ? 'is-bad'
      : speech?.state === 'loading' || speech?.state === 'starting'
      ? 'is-warn'
      : speech?.state === 'ready' || speech?.state === 'listening'
      ? 'is-ok'
      : ''
  const engineStateLabel =
    speech?.state === 'error'
      ? 'Needs attention'
      : speech?.state === 'loading'
      ? 'Loading model…'
      : speech?.state === 'starting'
      ? 'Starting…'
      : speech?.state === 'listening'
      ? 'Listening'
      : speech?.state === 'ready'
      ? 'Ready'
      : 'Standby'

  async function recheckSpeech() {
    setProbing(true)
    try {
      const status = await window.cuestaDesktop?.getSpeechStatus?.()
      if (status) setSpeech(status)
    } finally {
      setProbing(false)
    }
  }

  async function retryWhisper() {
    await window.cuestaDesktop?.restartSpeechEngine?.()
    window.setTimeout(() => void recheckSpeech(), 600)
  }

  async function handlePickExe() {
    if (window.cuestaDesktop?.pickCustomExe) {
      const picked = await window.cuestaDesktop.pickCustomExe()
      if (picked) {
        setNewAppPath(picked)
        if (!newAppName) {
          const filename = picked.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') || ''
          setNewAppName(filename.charAt(0).toUpperCase() + filename.slice(1))
        }
      }
    }
  }

  function handleAddCustomApp() {
    setAddError('')
    if (!newAppName.trim()) {
      setAddError('Application name is required.')
      return
    }
    if (!isValidCustomExe(newAppPath.trim())) {
      setAddError('Invalid path. Must be an absolute local drive path ending in .exe (e.g. C:\\Tools\\app.exe).')
      return
    }

    const triggers = newAppTriggers
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    if (triggers.length === 0) {
      triggers.push(newAppName.trim().toLowerCase())
    }

    const app: AppDescriptor = {
      id: `custom-${Date.now()}`,
      name: newAppName.trim(),
      category: 'custom',
      command: newAppPath.trim(),
      voiceTriggers: triggers,
      description: `Custom executable: ${newAppPath.trim()}`,
    }

    const next = [...customApps, app]
    setCustomApps(next)
    saveCustomApps(next)
    setNewAppName('')
    setNewAppPath('')
    setNewAppTriggers('')
    onNotice(`Added application: ${app.name}`)
  }

  function handleDeleteCustomApp(id: string) {
    const next = customApps.filter((a) => a.id !== id)
    setCustomApps(next)
    saveCustomApps(next)
    onNotice('Custom application removed.')
  }

  async function handleLaunchApp(app: AppDescriptor) {
    const res = await launchDesktopApp(app.id, app.category === 'custom' ? app.command : undefined)
    if (res.ok) {
      onNotice(`Launched: ${app.name}`)
    } else {
      onNotice(`Launch notice: ${res.reason || 'Failed to start'}`)
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-grid">
        {/* Left Column: Allowlisted Windows Apps */}
        <section className="settings-card">
          <div className="card-header">
            <h3 className="panel-title">Voice & Switch App Router</h3>
          </div>
          <p className="input-hint">
            Launch approved Windows apps by voice ("open notepad") or mapped facial switches. Only verified local executables run.
          </p>

          <div className="app-allowlist">
            {[...DEFAULT_APPS, ...customApps].map((app) => (
              <div key={app.id} className="app-item-row">
                <div className="row-inline gap-3">
                  <div className="app-icon-wrap">
                    <AppWindow size={15} className="text-secondary" />
                  </div>
                  <div className="app-meta-col">
                    <span className="app-name">{app.name}</span>
                    <span className="text-xs text-muted font-mono">
                      say "open {app.voiceTriggers[0]}"
                    </span>
                  </div>
                </div>
                <div className="row-inline">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleLaunchApp(app)}
                  >
                    <span>Launch</span>
                    <ExternalLink size={11} />
                  </button>
                  {app.category === 'custom' && (
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleDeleteCustomApp(app.id)}
                      title="Remove"
                      aria-label={`Remove ${app.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="add-app-form">
            <h4 className="card-label">Register Custom Executable</h4>
            <div className="form-stack">
              <input
                type="text"
                className="text-input"
                placeholder="Display Name (e.g. Obsidian)"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
              />
              <div className="row-inline">
                <input
                  type="text"
                  className="text-input flex-1 font-mono"
                  placeholder="Absolute .exe Path (C:\Users\...\app.exe)"
                  value={newAppPath}
                  onChange={(e) => setNewAppPath(e.target.value)}
                />
                {desktopAvailable() && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handlePickExe()}
                    title="Browse for executable"
                  >
                    <FolderOpen size={14} />
                  </button>
                )}
              </div>
              <input
                type="text"
                className="text-input"
                placeholder="Voice triggers (comma-separated, e.g. obsidian, notes)"
                value={newAppTriggers}
                onChange={(e) => setNewAppTriggers(e.target.value)}
              />
              {addError && <p className="text-danger text-xs">{addError}</p>}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleAddCustomApp}
              >
                <Plus size={13} />
                <span>Add Approved Executable</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Speech Engine, Dwell & Backup */}
        <div className="settings-sidebar-col">
          <section className="settings-card">
            <div className="card-header">
              <div className="row-inline">
                <Mic size={15} className="text-secondary" />
                <h3 className="panel-title">Speech & Dictation</h3>
              </div>
            </div>
            <p className="input-hint">
              <strong>Whisper Neural</strong> provides state-of-the-art offline transcription for Dictation and Control. <strong>Windows Voice Typing (Win+H)</strong> is also supported.
            </p>
            <select
              className="select-input"
              value={settings.speechProvider}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  speechProvider: e.target.value as Settings['speechProvider'],
                })
              }
            >
              <option value="whisper">Whisper Neural (Offline • High Accuracy • Ctrl+Win)</option>
              <option value="windows-voice-typing">Windows Voice Typing (Win+H)</option>
              <option value="browser-speech">Browser Web Speech (Chrome / Edge)</option>
            </select>

            {desktopAvailable() ? (
              <div className="speech-health">
                <div className="health-row">
                  <span className="health-key">Active engine</span>
                  <span className={`health-value ${engineStateClass}`}>
                    <span className="health-dot" />
                    {engineName}
                  </span>
                </div>
                <div className="health-row">
                  <span className="health-key">Status</span>
                  <span className={`health-value ${engineStateClass}`}>{engineStateLabel}</span>
                </div>
                <div className="health-row">
                  <span className="health-key">Whisper model</span>
                  <span className="health-value">{speech?.model || 'small.en'}</span>
                </div>
                <div className="health-row">
                  <span className="health-key">Python runtime</span>
                  <span className={`health-value ${speech?.depsReady ? 'is-ok' : 'is-bad'}`}>
                    {speech?.depsReady ? 'Installed' : 'Not detected'}
                  </span>
                </div>

                {speech?.detail && <p className="health-hint">{speech.detail}</p>}

                {!speech?.depsReady && (
                  <p className="health-hint">
                    Dictation works through the built-in Windows Speech fallback. Install the neural model
                    for higher accuracy:
                    <code className="code-line">npm run speech:setup</code>
                  </p>
                )}

                <div className="row-inline">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void recheckSpeech()}
                    disabled={probing}
                  >
                    <RefreshCw size={12} />
                    <span>{probing ? 'Checking…' : 'Recheck setup'}</span>
                  </button>
                  {!speech?.depsReady && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryWhisper()}>
                      <span>Retry Whisper</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="health-hint">
                Browser preview uses the Web Speech API. Launch the Windows desktop build for local Whisper
                dictation.
              </p>
            )}

            <div className="add-app-form">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={settings.ollamaEnabled}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, ollamaEnabled: e.target.checked })
                  }
                />
                <span>Use Local AI (Ollama) for punctuation & natural commands</span>
              </label>

              {settings.ollamaEnabled && (
                <div className="row-inline">
                  <input
                    type="text"
                    className="text-input flex-1 font-mono"
                    value={settings.ollamaModel}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, ollamaModel: e.target.value })
                    }
                    placeholder="qwen2.5:3b"
                  />
                  {desktopAvailable() && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void window.cuestaDesktop?.getOllamaStatus?.().then((res) => {
                          if (res?.available) {
                            onUpdateSettings({
                              ...settings,
                              ollamaModel: res.selectedModel || settings.ollamaModel,
                            })
                            onNotice(`Ollama live: ${res.models.slice(0, 3).join(', ')}`)
                          } else {
                            onNotice('Ollama server offline at localhost:11434 (deterministic parser active).')
                          }
                        })
                      }}
                    >
                      Detect Local
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="settings-card">
            <div className="card-header">
              <div className="row-inline">
                <Keyboard size={15} className="text-secondary" />
                <h3 className="panel-title">Global Hotkeys</h3>
              </div>
            </div>
            <div className="shortcut-list">
              <div className="shortcut-row">
                <div className="shortcut-keys">
                  <kbd>Ctrl</kbd> + <kbd>Win</kbd>
                </div>
                <span className="shortcut-desc">Toggle Dictation & Voice Control</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-keys">
                  <kbd>Shift</kbd> + <kbd>Win</kbd>
                </div>
                <span className="shortcut-desc">Toggle Studio / Transparent Float Pill</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-keys">
                  <kbd>Alt</kbd> + <kbd>P</kbd>
                </div>
                <span className="shortcut-desc">Pause / Resume All Gestures & Cursor</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-keys">
                  <kbd>Alt</kbd> + <kbd>C</kbd>
                </div>
                <span className="shortcut-desc">Recenter Head Cursor to Screen Center</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-keys">
                  <kbd>Space</kbd>
                </div>
                <span className="shortcut-desc">Manual Sample Capture in Trainer</span>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="card-header">
              <div className="row-inline">
                <Sliders size={15} className="text-secondary" />
                <h3 className="panel-title">Pointer Dwell & Scanning</h3>
              </div>
            </div>
            <div className="slider-group">
              <div className="slider-header">
                <span className="input-label">Head Cursor Dwell Hold</span>
                <span className="tabular-nums font-mono text-xs">{settings.headPointer.dwellMs} ms</span>
              </div>
              <input
                type="range"
                min="450"
                max="1800"
                step="50"
                value={settings.headPointer.dwellMs}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    headPointer: {
                      ...settings.headPointer,
                      dwellMs: parseInt(e.target.value, 10),
                    },
                  })
                }
                className="range-input"
              />
            </div>

            <div className="slider-group">
              <div className="slider-header">
                <span className="input-label">Auto-Scan Interval</span>
                <span className="tabular-nums font-mono text-xs">{settings.scanIntervalMs} ms</span>
              </div>
              <input
                type="range"
                min="500"
                max="3500"
                step="100"
                value={settings.scanIntervalMs}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, scanIntervalMs: parseInt(e.target.value, 10) })
                }
                className="range-input"
              />
            </div>
          </section>

          <section className="settings-card">
            <div className="card-header">
              <h3 className="panel-title">Profile Vault Backup</h3>
            </div>
            <p className="input-hint">
              Export personal numeric switch profiles as JSON for backup or portable transfer.
            </p>
            <div className="form-stack">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onExportProfiles}
              >
                <Download size={13} />
                <span>Export Profiles ({profiles.length} switches)</span>
              </button>

              <label className="btn btn-secondary btn-sm cursor-pointer">
                <Upload size={13} />
                <span>Import Profiles from JSON</span>
                <input
                  type="file"
                  accept="application/json"
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onImportProfiles(file)
                  }}
                />
              </label>

              <button
                type="button"
                className="btn btn-ghost btn-sm text-muted"
                onClick={onResetProfiles}
              >
                <RotateCcw size={12} />
                <span>Reset to Demo Switch</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
