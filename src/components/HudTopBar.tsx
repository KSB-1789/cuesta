import React from 'react'
import {
  Zap,
  Mic,
  Minimize2,
  Eye,
  MousePointer2,
  Crosshair,
  Pause,
  Play,
  Terminal,
  Sparkles,
} from 'lucide-react'
import type { VoiceMode } from '../lib/types'
import { HotkeyBadge, StatusBadge } from './StatusBadges'
import { VoiceWaveform } from './VoiceWaveform'

interface HudTopBarProps {
  cameraState: string
  dictationState: { state: string; text: string; volume?: number }
  pointerEnabled: boolean
  gesturesPaused: boolean
  voiceMode: VoiceMode
  aiReady?: boolean
  armedCount?: number
  onToggleCompact: () => void
  onToggleDictation: () => void
  onToggleVoiceMode: () => void
  onTogglePause: () => void
  onTogglePointer: () => void
  onRecenterPointer: () => void
}

export function HudTopBar({
  cameraState,
  dictationState,
  pointerEnabled,
  gesturesPaused,
  voiceMode,
  aiReady = false,
  armedCount = 0,
  onToggleCompact,
  onToggleDictation,
  onToggleVoiceMode,
  onTogglePause,
  onTogglePointer,
  onRecenterPointer,
}: HudTopBarProps) {
  const isListening = dictationState.state === 'listening'

  return (
    <header className="hud-top-bar">
      <div className="hud-top-left">
        <StatusBadge tone={cameraState === 'ready' ? 'emerald' : 'neutral'} icon={<Eye size={12} />}>
          {cameraState === 'ready' ? 'Camera On' : 'Camera Off'}
        </StatusBadge>

        {armedCount > 0 && (
          <StatusBadge tone={gesturesPaused ? 'neutral' : 'emerald'} icon={<Zap size={12} />}>
            {gesturesPaused ? `${armedCount} Paused` : `${armedCount} Active`}
          </StatusBadge>
        )}

        {aiReady && (
          <StatusBadge tone="emerald" icon={<Sparkles size={11} />}>
            AI Ready
          </StatusBadge>
        )}
      </div>

      <div className="hud-top-center">
        {dictationState.text && (
          <div className={`dictation-ticker ${isListening ? 'is-live' : ''}`}>
            <VoiceWaveform active={isListening} volume={dictationState.volume} />
            <span className="ticker-label">{voiceMode === 'control' ? 'CTRL' : isListening ? 'DICT' : 'DONE'}</span>
            <span className="ticker-text">{dictationState.text}</span>
          </div>
        )}
      </div>

      <div className="hud-top-right">
        <button
          type="button"
          className={`top-pointer-btn ${gesturesPaused ? 'is-paused' : ''}`}
          onClick={onTogglePause}
          title="Pause or resume all gestures & head cursor (Alt + P)"
        >
          {gesturesPaused ? <Play size={12} /> : <Pause size={12} />}
          <span>{gesturesPaused ? 'Paused' : 'Gestures'}</span>
        </button>

        <button
          type="button"
          className={`top-pointer-btn ${pointerEnabled ? 'is-active' : ''}`}
          onClick={onTogglePointer}
          title="Toggle Head Cursor"
        >
          <MousePointer2 size={13} />
          <span>Cursor</span>
        </button>

        {pointerEnabled && (
          <button
            type="button"
            className="top-icon-btn"
            onClick={onRecenterPointer}
            title="Recenter Cursor (Alt + C)"
            aria-label="Recenter head cursor"
          >
            <Crosshair size={13} />
          </button>
        )}

        <button
          type="button"
          className={`top-pointer-btn ${voiceMode === 'control' ? 'is-control-mode' : ''}`}
          onClick={onToggleVoiceMode}
          title={
            voiceMode === 'dictation'
              ? 'Dictation Mode — click to switch to Device Control'
              : 'Device Control Mode — click to switch to Dictation'
          }
        >
          {voiceMode === 'control' ? <Terminal size={12} /> : <Mic size={12} />}
          <span>{voiceMode === 'control' ? 'Control' : 'Dictate'}</span>
        </button>

        <div className="hotkey-pill" title="Press Ctrl+Win anywhere in Windows">
          <HotkeyBadge keys={['Ctrl', 'Win']} active={isListening} />
          <button
            type="button"
            className={`hotkey-toggle-btn ${isListening ? 'listening' : ''}`}
            onClick={onToggleDictation}
            aria-label="Toggle voice input"
          >
            <Mic size={13} />
          </button>
        </div>

        <button
          type="button"
          className="hud-collapse-btn"
          onClick={onToggleCompact}
          title="Collapse into Floating HUD Pill (Shift + Win)"
        >
          <Minimize2 size={13} />
          <span>Float Pill</span>
        </button>
      </div>
    </header>
  )
}
