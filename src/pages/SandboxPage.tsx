import React, { useState, useEffect, useRef } from 'react'
import {
  Mic,
  RotateCcw,
  CheckCircle,
  FileText,
  Volume2,
  MousePointer2,
} from 'lucide-react'
import type { ActionKind, VoiceMode } from '../lib/types'
import { desktopAvailable, type UiElementSummary } from '../lib/desktop'
import { dictationService } from '../lib/dictation'

interface ActionLogEntry {
  id: string
  timestamp: string
  action: string
  source: 'switch' | 'voice' | 'manual' | 'dwell'
}

const SCAN_ITEMS = [
  { id: 'btn-read', label: '1. Speak Confirmation', desc: 'Reads status aloud via Windows Speech Synthesis' },
  { id: 'btn-approve', label: '2. Confirm Action', desc: 'Increments verified click counter in real time' },
  { id: 'btn-next-tab', label: '3. Toggle Focus Target', desc: 'Tests pointer & switch highlight switching' },
  { id: 'btn-scratchpad', label: '4. Focus & Dictate', desc: 'Places cursor in scratchpad and toggles voice input' },
]

interface SandboxPageProps {
  onTriggerAction: (action: ActionKind) => void
  dictationState: { state: string; text: string }
  pointerEnabled: boolean
  voiceMode: VoiceMode
  onToggleVoiceMode: (mode?: VoiceMode) => void
  onTogglePointer: () => void
  onNotice: (msg: string) => void
}

export function SandboxPage({
  onTriggerAction,
  dictationState,
  pointerEnabled,
  voiceMode,
  onToggleVoiceMode,
  onTogglePointer,
  onNotice,
}: SandboxPageProps) {
  const [scanIndex, setScanIndex] = useState(0)
  const scanIndexRef = useRef(0)
  scanIndexRef.current = scanIndex

  const [scanActive, setScanActive] = useState(true)
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([])
  const [scratchpadText, setScratchpadText] = useState('')
  const [selectedDemoItem, setSelectedDemoItem] = useState<string | null>(null)
  const [confirmCount, setConfirmCount] = useState(0)
  const [briefingState, setBriefingState] = useState('Idle')
  const [uiTargets, setUiTargets] = useState<UiElementSummary[]>([])
  const [scanningUi, setScanningUi] = useState(false)

  const scratchpadRef = useRef<HTMLTextAreaElement>(null)

  function activateTarget(itemId: string, label: string) {
    setSelectedDemoItem(label)
    if (itemId === 'btn-read') {
      setBriefingState('Confirmed audio cue ✓')
      try {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(new SpeechSynthesisUtterance('Switch click confirmed.'))
        }
      } catch {}
      onNotice('Arena Target 1 triggered: Spoken confirmation.')
    } else if (itemId === 'btn-approve') {
      setConfirmCount((c) => {
        const next = c + 1
        onNotice(`Arena Target 2 clicked (${next}x confirmed).`)
        return next
      })
    } else if (itemId === 'btn-next-tab') {
      const next = (scanIndexRef.current + 1) % SCAN_ITEMS.length
      setScanIndex(next)
      onNotice(`Focused item ${next + 1}.`)
    } else if (itemId === 'btn-scratchpad') {
      scratchpadRef.current?.focus()
      void dictationService.toggle()
      onNotice('Scratchpad focused & dictation toggled.')
    }
  }

  useEffect(() => {
    function handleAction(e: CustomEvent<{ action: string; source?: string }>) {
      const entry: ActionLogEntry = {
        id: Math.random().toString(36).slice(2),
        timestamp: new Date().toLocaleTimeString(),
        action: e.detail.action,
        source: (e.detail.source as ActionLogEntry['source']) || 'switch',
      }
      setActionLogs((curr) => [entry, ...curr.slice(0, 19)])

      if (e.detail.action === 'select') {
        const item = SCAN_ITEMS[scanIndexRef.current]
        if (item) activateTarget(item.id, item.label)
      } else if (e.detail.action === 'next') {
        setScanIndex((curr) => (curr + 1) % SCAN_ITEMS.length)
      } else if (e.detail.action === 'previous') {
        setScanIndex((curr) => (curr - 1 + SCAN_ITEMS.length) % SCAN_ITEMS.length)
      }
    }

    function handleVoice(e: CustomEvent<{ text: string }>) {
      const entry: ActionLogEntry = {
        id: Math.random().toString(36).slice(2),
        timestamp: new Date().toLocaleTimeString(),
        action: `Voice: "${e.detail.text}"`,
        source: 'voice',
      }
      setActionLogs((curr) => [entry, ...curr.slice(0, 19)])
    }

    function handleDictationInsert(e: CustomEvent<{ text: string }>) {
      // Only append here if the scratchpad wasn't already directly updated via activeElement
      if (document.activeElement !== scratchpadRef.current && e.detail.text) {
        setScratchpadText((prev) => (prev ? `${prev.trimEnd()} ${e.detail.text}` : e.detail.text))
      }
    }

    window.addEventListener('cuesta:action:triggered' as any, handleAction as any)
    window.addEventListener('cuesta:voice:command' as any, handleVoice as any)
    window.addEventListener('cuesta:dictation:inserted' as any, handleDictationInsert as any)
    return () => {
      window.removeEventListener('cuesta:action:triggered' as any, handleAction as any)
      window.removeEventListener('cuesta:voice:command' as any, handleVoice as any)
      window.removeEventListener('cuesta:dictation:inserted' as any, handleDictationInsert as any)
    }
  }, [])

  return (
    <div className="sandbox-view">
      <div className="sandbox-grid">
        {/* Left Column: Scanning & Head Cursor Arena */}
        <section className="sandbox-arena">
          <div className="arena-header">
            <h2 className="panel-title">Click & Switch Target Matrix</h2>
            <div className="row-inline">
              <button
                type="button"
                className={`btn btn-sm ${pointerEnabled ? 'btn-primary' : 'btn-secondary'}`}
                onClick={onTogglePointer}
              >
                <MousePointer2 size={12} />
                <span>{pointerEnabled ? 'Cursor: ON' : 'Start Head Cursor'}</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${scanActive ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setScanActive(!scanActive)}
              >
                {scanActive ? 'Scan Highlight: ON' : 'Scan Paused'}
              </button>
            </div>
          </div>

          <p className="input-hint mb-4">
            Aim with <strong>Head Cursor</strong> and trigger your eyebrow click, or use <strong>Select</strong> / <strong>Next</strong> switches to step through and activate buttons directly.
          </p>

          <div className="scan-targets-list">
            {SCAN_ITEMS.map((item, idx) => {
              const isFocused = scanIndex === idx && scanActive
              const isSelected = selectedDemoItem === item.label
              const badge =
                item.id === 'btn-approve' && confirmCount > 0
                  ? `${confirmCount}x`
                  : item.id === 'btn-read' && briefingState !== 'Idle'
                  ? briefingState
                  : null

              return (
                <button
                  key={item.id}
                  type="button"
                  data-scan-focused={isFocused ? 'true' : undefined}
                  className={`scan-target-card ${isFocused ? 'scan-focused' : ''} ${
                    isSelected ? 'scan-selected' : ''
                  }`}
                  onClick={() => {
                    setScanIndex(idx)
                    activateTarget(item.id, item.label)
                  }}
                >
                  <div className="scan-card-inner">
                    <div className="scan-card-left">
                      <div className="row-inline">
                        {isFocused && <span className="focus-indicator" />}
                        <span className="target-title">{item.label}</span>
                        {badge && <span className="status-pill status-pill-active tabular-nums">{badge}</span>}
                      </div>
                      <span className="target-desc">{item.desc}</span>
                    </div>
                    {isSelected && <CheckCircle size={16} className="text-accent" />}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Dictation & Device Control Workspace */}
          <div className="scratchpad-box mt-4">
            <div className="scratchpad-header">
              <div className="row-inline">
                <FileText size={14} className="text-secondary" />
                <span className="card-label">
                  {voiceMode === 'control' ? 'Device Control Console' : 'Live Dictation Scratchpad'}
                </span>
              </div>
              <div className="row-inline">
                <button
                  type="button"
                  className={`btn btn-sm ${voiceMode === 'dictation' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => onToggleVoiceMode('dictation')}
                >
                  Dictate
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${voiceMode === 'control' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => onToggleVoiceMode('control')}
                >
                  Control
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    dictationState.state === 'listening' ? 'btn-danger' : 'btn-secondary'
                  }`}
                  onClick={() => void dictationService.toggle()}
                >
                  <Mic size={12} />
                  <span>{dictationState.state === 'listening' ? 'Stop' : 'Start (Ctrl+Win)'}</span>
                </button>
              </div>
            </div>
            <p className="text-xs text-muted">
              {voiceMode === 'control'
                ? 'Control Mode: say "snap left", "switch window", "click Save", or "open calculator" (requires "open/launch").'
                : 'Dictation Mode: pure prose + punctuation ("period", "comma", "new line", "scratch that"). Commands ignored.'}
            </p>
            <textarea
              ref={scratchpadRef}
              className="scratchpad-textarea"
              placeholder={
                voiceMode === 'control'
                  ? 'Speak a command — or test phrases in Dictation Mode without launching apps unexpectedly...'
                  : 'Press Ctrl+Win (or Start) and speak naturally — interim words stream live above and clean text lands here...'
              }
              value={scratchpadText}
              onChange={(e) => setScratchpadText(e.target.value)}
              rows={4}
            />
          </div>
        </section>

        {/* Right Column: Live Event Telemetry & Simulation */}
        <section className="sandbox-telemetry">
          <div className="telemetry-header">
            <h3 className="panel-title">Live Event Feed</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setActionLogs([])}
              title="Clear log"
              aria-label="Clear event log"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          <div className="manual-trigger-bar">
            <span className="text-xs text-muted">Simulate:</span>
            <button type="button" className="pill-btn" onClick={() => onTriggerAction('click')}>
              Left Click
            </button>
            <button type="button" className="pill-btn" onClick={() => onTriggerAction('select')}>
              Select Highlighted
            </button>
            <button type="button" className="pill-btn" onClick={() => onTriggerAction('next')}>
              Next Highlight
            </button>
            <button type="button" className="pill-btn" onClick={() => onTriggerAction('pause-gestures')}>
              Toggle Pause Gestures
            </button>
            <button type="button" className="pill-btn" onClick={() => onTriggerAction('dictation')}>
              <Volume2 size={11} />
              <span>Dictation</span>
            </button>
            {desktopAvailable() && (
              <button
                type="button"
                className="pill-btn"
                disabled={scanningUi}
                onClick={() => {
                  setScanningUi(true)
                  void window.cuestaDesktop
                    ?.listUiElements?.()
                    .then((res) => {
                      setUiTargets(res?.elements ?? [])
                      onNotice(`Found ${res?.elements?.length ?? 0} clickable controls in window.`)
                    })
                    .finally(() => setScanningUi(false))
                }}
              >
                <span>{scanningUi ? 'Scanning UI…' : 'Scan Screen Targets'}</span>
              </button>
            )}
          </div>

          {uiTargets.length > 0 && (
            <div className="manual-trigger-bar">
              <span className="text-xs text-muted">Say "click …":</span>
              {uiTargets.slice(0, 8).map((el, idx) => (
                <button
                  key={`${el.name}-${idx}`}
                  type="button"
                  className="pill-btn"
                  onClick={() => void window.cuestaDesktop?.clickUiElement?.(el.name)}
                >
                  {el.name}
                </button>
              ))}
            </div>
          )}

          <div className="event-log-container">
            {actionLogs.length === 0 ? (
              <div className="empty-log text-muted text-xs">
                <span>Waiting for eyebrow switches, dwell clicks, or voice commands…</span>
              </div>
            ) : (
              <ul className="event-log-list">
                {actionLogs.map((log) => (
                  <li key={log.id} className="event-log-row">
                    <span className="log-time tabular-nums font-mono">{log.timestamp}</span>
                    <span className={`log-source log-source-${log.source}`}>{log.source}</span>
                    <span className="log-action">{log.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
