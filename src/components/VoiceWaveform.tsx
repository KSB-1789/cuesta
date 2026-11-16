import React from 'react'

interface VoiceWaveformProps {
  active: boolean
  volume?: number
}

const BAR_WEIGHTS = [0.45, 0.8, 1.0, 0.72, 0.5]

export function VoiceWaveform({ active, volume = 0 }: VoiceWaveformProps) {
  const normVol = active ? Math.max(0.18, Math.min(1, volume / 70)) : 0.14

  return (
    <span className={`voice-waveform ${active ? 'is-active' : ''}`} aria-hidden="true">
      {BAR_WEIGHTS.map((weight, idx) => {
        const heightPct = Math.round(24 + normVol * weight * 76)
        return (
          <span
            key={idx}
            className="voice-wave-bar"
            style={{ height: `${heightPct}%` }}
          />
        )
      })}
    </span>
  )
}
