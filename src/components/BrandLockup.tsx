import React from 'react'

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? 'compact' : ''}`} aria-label="Cuesta Control Layer">
      <div className="brand-mark" aria-hidden="true">
        <span className="brand-ring-primary" />
        <span className="brand-ring-secondary" />
        <span className="brand-dot" />
      </div>
      {!compact && (
        <div className="brand-text">
          <span className="brand-word">cuesta</span>
          <span className="brand-badge">WIN DESKTOP</span>
        </div>
      )}
    </div>
  )
}
