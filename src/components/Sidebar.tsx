import React from 'react'
import {
  Activity,
  Layers,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { Page, SwitchProfile } from '../lib/types'
import { BrandLockup } from './BrandLockup'

interface SidebarProps {
  page: Page
  onNavigate: (page: Page) => void
  activeProfile: SwitchProfile | null
  profileCount: number
}

export function Sidebar({ page, onNavigate, profileCount }: SidebarProps) {
  return (
    <aside className="cuesta-sidebar">
      <div className="sidebar-header">
        <BrandLockup />
      </div>

      <nav className="sidebar-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-button ${page === 'studio' ? 'active' : ''}`}
          onClick={() => onNavigate('studio')}
        >
          <Activity size={16} />
          <span>Studio</span>
          {profileCount > 0 && <span className="nav-count">{profileCount}</span>}
        </button>

        <button
          type="button"
          className={`nav-button ${page === 'sandbox' ? 'active' : ''}`}
          onClick={() => onNavigate('sandbox')}
        >
          <Layers size={16} />
          <span>Sandbox</span>
        </button>

        <button
          type="button"
          className={`nav-button ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <SettingsIcon size={16} />
          <span>Settings & Apps</span>
        </button>
      </nav>
    </aside>
  )
}
