import React from 'react'

interface LiveMeterProps {
  value: number
  threshold?: number
  label?: string
  color?: 'emerald' | 'cyan' | 'coral'
  showScale?: boolean
}

export function LiveMeter({
  value,
  threshold = 0.68,
  label = 'Signal Confidence',
  color = 'emerald',
  showScale = true,
}: LiveMeterProps) {
  const percent = Math.min(100, Math.max(0, Math.round(value * 100)))
  const thresholdPercent = Math.min(100, Math.max(0, Math.round(threshold * 100)))
  const isTriggered = value >= threshold

  return (
    <div className={`live-meter-container ${color} ${isTriggered ? 'triggered' : ''}`}>
      <div className="live-meter-header">
        <span className="live-meter-label">{label}</span>
        <div className="live-meter-readout">
          {isTriggered && <span className="trigger-pill">TRIGGER READY</span>}
          <strong className="meter-val">{percent}%</strong>
        </div>
      </div>
      <div
        className="live-meter-track"
        role="meter"
        aria-label={`${label}: ${percent}%`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`live-meter-fill ${isTriggered ? 'active-fill' : ''}`}
          style={{ width: `${percent}%` }}
        />
        <div
          className="live-meter-threshold-pin"
          style={{ left: `${thresholdPercent}%` }}
          title={`Sensitivity threshold: ${thresholdPercent}%`}
        >
          <span className="threshold-tooltip">{thresholdPercent}%</span>
        </div>
      </div>
      {showScale && (
        <div className="live-meter-scale">
          <span>0% NEUTRAL</span>
          <span className="scale-center">THRESHOLD ({thresholdPercent}%)</span>
          <span>100% SIGNAL</span>
        </div>
      )}
    </div>
  )
}
