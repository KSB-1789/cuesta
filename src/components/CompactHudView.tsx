import React, { useRef } from 'react'
import {
  Eye,
  Mic,
  Maximize2,
  MousePointer2,
  Crosshair,
  Zap,
  Pause,
  Play,
  Terminal,
} from 'lucide-react'
import type { SwitchProfile, VoiceMode } from '../lib/types'
import { signalLabels } from '../lib/vision'
import { VoiceWaveform } from './VoiceWaveform'

interface CompactHudViewProps {
  activeProfile: SwitchProfile | null
  activeLabel?: string
  liveScore: number
  threshold?: number
  cameraReady: boolean
  pointerEnabled: boolean
  gesturesPaused?: boolean
  voiceMode?: VoiceMode
  dictationState: { state: string; text: string; isInterim?: boolean; volume?: number }
  armedCount?: number
  notice?: string
  isSeparateWindow?: boolean
  onExpandStudio: () => void
  onToggleDictation: () => void
  onToggleVoiceMode?: () => void
  onTogglePause?: () => void
  onTogglePointer: () => void
  onRecenterPointer: () => void
  onTriggerActive: () => void
}

export function CompactHudView({
  activeProfile,
  activeLabel,
  liveScore,
  threshold: propThreshold,
  cameraReady,
  pointerEnabled,
  gesturesPaused = false,
  voiceMode = 'dictation',
  dictationState,
  armedCount = 0,
  notice = '',
  isSeparateWindow = false,
  onExpandStudio,
  onToggleDictation,
  onToggleVoiceMode,
  onTogglePause,
  onTogglePointer,
  onRecenterPointer,
  onTriggerActive,
}: CompactHudViewProps) {
  const isListening = dictationState.state === 'listening'
  const threshold = propThreshold ?? activeProfile?.sensitivity ?? 0.54
  const scorePercent = Math.min(100, Math.round(liveScore * 100))
  const isTriggered = !gesturesPaused && liveScore >= threshold
  const label = gesturesPaused
    ? 'Gestures Paused'
    : activeLabel || (armedCount > 1 ? `${armedCount} Armed` : (activeProfile?.name ?? 'Standby'))

  const showDrawer = Boolean((isListening && dictationState.text) || notice)
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSeparateWindow) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button')) return
    dragOriginRef.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSeparateWindow || !dragOriginRef.current) return
    const dx = e.screenX - dragOriginRef.current.x
    const dy = e.screenY - dragOriginRef.current.y
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
      dragOriginRef.current = { x: e.screenX, y: e.screenY }
      window.cuestaDesktop?.moveHudBy(dx, dy)
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragOriginRef.current) {
      dragOriginRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  return (
    <div className="compact-hud-stack">
      <div
        className={`compact-hud-widget ${isListening ? 'hud-listening' : ''} ${isTriggered ? 'hud-triggered' : ''} ${
          gesturesPaused ? 'hud-paused' : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="hud-drag-handle" title="Drag floating bar anywhere">
          <span className="hud-drag-pip" />
          <span className="hud-drag-pip" />
          <span className="hud-drag-pip" />
        </div>

        <div className="hud-status-node" title={cameraReady ? 'Optical stream active' : 'Camera standby'}>
          <span className={`status-lamp ${cameraReady ? 'active' : ''}`} />
          <Eye size={12} className={cameraReady ? 'text-secondary' : 'text-muted'} />
        </div>

        <div className="hud-divider" />

        <div className="hud-switch-node">
          <div className="hud-switch-meta">
            <span className="hud-switch-name">{label}</span>
            <span className="hud-switch-score tabular-nums">{gesturesPaused ? 'HOLD' : `${scorePercent}%`}</span>
          </div>
          <div className="hud-mini-meter">
            <div
              className={`hud-mini-fill ${isTriggered ? 'triggered' : ''}`}
              style={{ width: gesturesPaused ? '0%' : `${scorePercent}%` }}
            />
            <div className="hud-mini-thresh" style={{ left: `${Math.round(threshold * 100)}%` }} />
          </div>
        </div>

        <div className="hud-divider" />

        {onTogglePause && (
          <button
            type="button"
            className={`hud-icon-btn ${gesturesPaused ? 'is-paused-btn' : ''}`}
            onClick={onTogglePause}
            title={gesturesPaused ? 'Resume All Gestures (Alt + P)' : 'Pause All Gestures (Alt + P)'}
            aria-label={gesturesPaused ? 'Resume gestures' : 'Pause gestures'}
          >
            {gesturesPaused ? <Play size={11} /> : <Pause size={11} />}
          </button>
        )}

        <button
          type="button"
          className={`hud-pill-btn ${pointerEnabled && !gesturesPaused ? 'is-armed' : ''}`}
          onClick={onTogglePointer}
          title={pointerEnabled ? 'Head Cursor ON (click to pause)' : 'Enable Head Cursor'}
        >
          <MousePointer2 size={12} />
          <span>{pointerEnabled ? 'Ptr' : 'Ptr Off'}</span>
        </button>

        {pointerEnabled && (
          <button
            type="button"
            className="hud-icon-btn"
            onClick={onRecenterPointer}
            title="Recenter Cursor (Alt + C)"
          >
            <Crosshair size={12} />
          </button>
        )}

        {onToggleVoiceMode && (
          <button
            type="button"
            className={`hud-icon-btn ${voiceMode === 'control' ? 'is-control-btn' : ''}`}
            onClick={onToggleVoiceMode}
            title={voiceMode === 'control' ? 'Device Control Mode (click for Dictation)' : 'Dictation Mode (click for Control)'}
            aria-label="Switch voice mode"
          >
            <Terminal size={11} />
          </button>
        )}

        <button
          type="button"
          className={`hud-dictation-btn ${isListening ? 'listening' : ''}`}
          onClick={onToggleDictation}
          title={`Toggle ${voiceMode === 'control' ? 'Control' : 'Dictation'} (Ctrl + Win)`}
        >
          {isListening ? <VoiceWaveform active volume={dictationState.volume} /> : <Mic size={12} />}
          <span>{isListening ? 'Stop' : voiceMode === 'control' ? 'Cmd' : 'Dictate'}</span>
        </button>

        {activeProfile && (
          <button
            type="button"
            className={`hud-icon-btn ${isTriggered ? 'active-pulse' : ''}`}
            onClick={onTriggerActive}
            title={`Test Trigger: ${signalLabels[activeProfile.signal]}`}
          >
            <Zap size={12} />
          </button>
        )}

        <button
          type="button"
          className="hud-expand-btn"
          onClick={onExpandStudio}
          title="Expand Studio (Shift + Win)"
        >
          <Maximize2 size={11} />
          <span>Studio</span>
        </button>
      </div>

      {showDrawer && (
        <div className="hud-live-drawer" role="status">
          {isListening && (
            <div className="hud-drawer-row">
              <span className="status-lamp active" />
              <span className="hud-drawer-tag">{voiceMode === 'control' ? 'CTRL' : 'DICT'}</span>
              <span className="hud-drawer-text">{dictationState.text}</span>
            </div>
          )}
          {notice && (!isListening || !notice.startsWith('Dictated:')) && (
            <div className="hud-drawer-row">
              <span className="hud-drawer-tag is-event">EVENT</span>
              <span className="hud-drawer-text">{notice}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
