import React from 'react'

export function SignalDot({ live = false, color = 'emerald' }: { live?: boolean; color?: 'emerald' | 'cyan' | 'coral' | 'amber' }) {
  return <span className={`signal-dot ${color} ${live ? 'is-live' : ''}`} aria-hidden="true" />
}

export function StatusBadge({
  children,
  tone = 'neutral',
  pulsing = false,
  icon,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'emerald' | 'cyan' | 'coral' | 'amber'
  pulsing?: boolean
  icon?: React.ReactNode
}) {
  return (
    <span className={`status-badge ${tone}`}>
      {icon ? <span className="badge-icon">{icon}</span> : <SignalDot live={pulsing || tone === 'emerald'} color={tone === 'neutral' ? 'emerald' : tone} />}
      <span className="badge-text">{children}</span>
    </span>
  )
}

export function HotkeyBadge({ keys, active = false }: { keys: string[]; active?: boolean }) {
  return (
    <div className={`hotkey-badge ${active ? 'active' : ''}`}>
      {keys.map((key, idx) => (
        <React.Fragment key={key}>
          <kbd>{key}</kbd>
          {idx < keys.length - 1 && <span className="hotkey-plus">+</span>}
        </React.Fragment>
      ))}
    </div>
  )
}
