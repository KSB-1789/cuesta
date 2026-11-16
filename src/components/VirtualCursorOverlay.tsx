import React from 'react'

interface VirtualCursorOverlayProps {
  visible: boolean
  nx: number
  ny: number
  dwellProgress: number
  justClicked: boolean
}

export function VirtualCursorOverlay({
  visible,
  nx,
  ny,
  dwellProgress,
  justClicked,
}: VirtualCursorOverlayProps) {
  if (!visible) return null

  const left = `${(nx * 100).toFixed(2)}%`
  const top = `${(ny * 100).toFixed(2)}%`
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, dwellProgress)))

  return (
    <div
      className={`virtual-cursor-reticle ${justClicked ? 'is-clicked' : ''}`}
      style={{ left, top }}
      aria-hidden="true"
    >
      {dwellProgress > 0.02 && (
        <svg className="virtual-cursor-dwell-ring" width="36" height="36" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="rgba(52, 211, 153, 0.25)"
            strokeWidth="2.5"
          />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="#34d399"
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
          />
        </svg>
      )}
      <span className="virtual-cursor-core" />
    </div>
  )
}
