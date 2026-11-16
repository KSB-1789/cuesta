import React, { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Play,
  CheckCircle2,
  Trash2,
  Power,
  Zap,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  MousePointer2,
  Crosshair,
} from 'lucide-react'
import type { ActionKind, HeadPointerConfig, SignalKind, SwitchProfile } from '../lib/types'
import { signalLabels, actionLabels, signalNotes } from '../lib/vision'
import { LiveCameraPreview } from '../components/LiveCameraPreview'
import { LiveMeter } from '../components/LiveMeter'
import { DEFAULT_APPS } from '../lib/app-registry'
import { SwitchDetector } from '../lib/signal'

interface StudioPageProps {
  stream: MediaStream | null
  cameraState: 'idle' | 'requesting' | 'ready' | 'blocked'
  visionState: 'idle' | 'loading' | 'ready' | 'unavailable'
  profiles: SwitchProfile[]
  multiScores: Record<string, number>
  activeStates: Record<string, boolean>
  verifyScore: number
  headPointer: HeadPointerConfig
  gesturesPaused: boolean
  cursorUi: { nx: number; ny: number; dwellProgress: number }
  training: any
  onToggleProfile: (id: string) => void
  onDeleteProfile: (id: string) => void
  onTogglePause: () => void
  onRequestCamera: () => Promise<boolean>
  onTriggerProfileAction: (profile: SwitchProfile) => void
  onTriggerTestPulse: (action: ActionKind, mappedKey?: string, targetApp?: string) => void
  onUpdateHeadPointer: (patch: Partial<HeadPointerConfig>) => void
  onRecenterPointer: () => void
  onEnableDemoMode: () => void
}

const AVAILABLE_SIGNALS: SignalKind[] = [
  'eyebrow',
  'brow-furrow',
  'wink-left',
  'wink-right',
  'blink-hold',
  'squint',
  'smile',
  'mouth-open',
  'mouth-pucker',
  'cheek-puff',
  'jaw',
  'head-tilt',
  'head-turn',
  'nod',
  'finger-snap',
]

const AVAILABLE_ACTIONS: ActionKind[] = [
  'click',
  'double-click',
  'right-click',
  'select',
  'scroll-down',
  'scroll-up',
  'next',
  'previous',
  'pause-gestures',
  'dictation',
  'toggle-pointer',
  'recenter-pointer',
  'launch-app',
  'key',
  'back',
]

export function StudioPage({
  stream,
  cameraState,
  visionState,
  profiles,
  multiScores,
  activeStates,
  verifyScore,
  headPointer,
  gesturesPaused,
  cursorUi,
  training,
  onToggleProfile,
  onDeleteProfile,
  onTogglePause,
  onRequestCamera,
  onTriggerProfileAction,
  onTriggerTestPulse,
  onUpdateHeadPointer,
  onRecenterPointer,
  onEnableDemoMode,
}: StudioPageProps) {
  const [showTrainer, setShowTrainer] = useState(false)
  const [verifyTriggers, setVerifyTriggers] = useState(0)
  const verifyDetectorRef = useRef<SwitchDetector | null>(null)
  const trainerSectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (training.step !== 'verify') {
      verifyDetectorRef.current = null
      setVerifyTriggers(0)
      return
    }
    verifyDetectorRef.current = new SwitchDetector(training.sensitivity, training.holdMs, training.cooldownMs)
  }, [training.step])

  useEffect(() => {
    if (training.step !== 'verify' || !verifyDetectorRef.current) return
    verifyDetectorRef.current.updateConfig(training.sensitivity, training.holdMs, training.cooldownMs)
  }, [training.step, training.sensitivity, training.holdMs, training.cooldownMs])

  useEffect(() => {
    if (training.step !== 'verify' || !verifyDetectorRef.current) return
    const res = verifyDetectorRef.current.update(verifyScore)
    if (res.triggered) {
      setVerifyTriggers((c) => c + 1)
    }
  }, [verifyScore, training.step])

  async function handleStartCalibrationClick() {
    if (training.signalKind !== 'finger-snap' && cameraState !== 'ready') {
      const ok = await onRequestCamera()
      if (!ok) return
    }
    training.startCalibration()
  }

  return (
    <div className="studio-view">
      {/* Top Instrument Bar: Camera + Active Switches + Head Pointer Pilot */}
      <section className="instrument-panel">
        <div className="instrument-camera-col">
          <div className="camera-card">
            <div className="camera-header">
              <div className="row-inline">
                <span className={`status-lamp ${stream ? 'active' : ''}`} />
                <span className="card-label">Camera</span>
              </div>
              <span className="pill-tag">
                {visionState === 'ready' ? 'Ready' : visionState === 'loading' ? 'Starting' : 'Off'}
              </span>
            </div>

            <div className="camera-stage-wrap">
              <LiveCameraPreview stream={stream} className="studio-camera" showBadge={false} />
              {headPointer.enabled && stream && (
                <div className="camera-reticle-pip" title="Head Cursor Aim">
                  <span
                    className="camera-reticle-dot"
                    style={{
                      left: `${Math.round(cursorUi.nx * 100)}%`,
                      top: `${Math.round(cursorUi.ny * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {cameraState !== 'ready' && (
              <button
                type="button"
                className="btn btn-primary btn-sm camera-enable-btn"
                onClick={() => void onRequestCamera()}
              >
                <Camera size={14} />
                <span>{cameraState === 'requesting' ? 'Requesting Camera…' : 'Enable Camera'}</span>
              </button>
            )}
          </div>

          {/* Head Cursor Control Card */}
          <div className="pointer-pilot-card">
            <div className="pointer-pilot-header">
              <div className="row-inline">
                <MousePointer2 size={14} className={headPointer.enabled ? 'text-accent' : 'text-secondary'} />
                <span className="card-label">Head Cursor</span>
              </div>
              <button
                type="button"
                className={`status-pill ${headPointer.enabled ? 'status-pill-active' : 'status-pill-off'}`}
                onClick={() => {
                  if (!headPointer.enabled) onRecenterPointer()
                  onUpdateHeadPointer({ enabled: !headPointer.enabled })
                }}
              >
                {headPointer.enabled ? 'Active' : 'Off'}
              </button>
            </div>

            <p className="pointer-pilot-hint">
              Move your head to steer the cursor. Blink or raise brows to click.
            </p>

            <div className="pointer-pilot-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm flex-1"
                onClick={onRecenterPointer}
                title="Set current head posture as screen center (Alt+C)"
              >
                <Crosshair size={12} />
                <span>Recenter (Alt+C)</span>
              </button>

              <button
                type="button"
                className={`btn btn-sm ${headPointer.dwellClick ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onUpdateHeadPointer({ dwellClick: !headPointer.dwellClick })}
                title="Auto-click after holding cursor steady"
              >
                <span>{headPointer.dwellClick ? 'Dwell: ON' : 'Dwell Click'}</span>
              </button>
            </div>

            <div className="pointer-sliders">
              <label className="mini-slider">
                <div className="mini-slider-row">
                  <span>Speed</span>
                  <span className="tabular-nums font-mono">{headPointer.sensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="2.8"
                  step="0.1"
                  value={headPointer.sensitivity}
                  onChange={(e) => onUpdateHeadPointer({ sensitivity: parseFloat(e.target.value) })}
                  className="range-input"
                />
              </label>

              <label className="mini-slider">
                <div className="mini-slider-row">
                  <span>Smoothing</span>
                  <span className="tabular-nums font-mono">{Math.round(headPointer.smoothing * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.82"
                  step="0.05"
                  value={headPointer.smoothing}
                  onChange={(e) => onUpdateHeadPointer({ smoothing: parseFloat(e.target.value) })}
                  className="range-input"
                />
              </label>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={headPointer.invertX}
                  onChange={(e) => onUpdateHeadPointer({ invertX: e.target.checked })}
                />
                <span>Flip horizontal X</span>
              </label>
            </div>
          </div>
        </div>

        {/* Right Telemetry Column */}
        <div className="instrument-telemetry-col">
          <div className="telemetry-header-bar">
            <h2 className="panel-title">
              Active Switches ({profiles.filter((p) => p.enabled).length})
            </h2>

            <div className="row-inline">
              {gesturesPaused && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={onTogglePause}
                  title="Resume gestures & head cursor (Alt + P)"
                >
                  <span>Paused — Resume</span>
                </button>
              )}
              {cameraState !== 'ready' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onEnableDemoMode}
                >
                  <span>Try Demo</span>
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setShowTrainer(true)
                  training.resetTraining()
                  window.setTimeout(() => trainerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40)
                }}
              >
                <Sparkles size={13} />
                <span>Train New Switch</span>
              </button>
            </div>
          </div>

          <div className="meter-grid">
            {profiles.length === 0 ? (
              <div className="empty-state-box">
                <p className="text-secondary text-sm">
                  No switches trained yet. Click <strong>Train New Switch</strong> to map an eyebrow raise, smile, or head nod to Left Mouse Click.
                </p>
              </div>
            ) : (
              profiles.map((p) => {
                const score = multiScores[p.id] ?? 0
                const pct = Math.min(100, Math.round(score * 100))
                const isActive = activeStates[p.id] || score >= p.sensitivity
                return (
                  <div
                    key={p.id}
                    className={`meter-card ${isActive ? 'meter-card-triggered' : ''} ${
                      !p.enabled ? 'meter-card-disabled' : ''
                    }`}
                  >
                    <div className="meter-card-header">
                      <div className="row-inline">
                        <button
                          type="button"
                          className={`switch-toggle-dot ${p.enabled ? 'active' : ''}`}
                          onClick={() => onToggleProfile(p.id)}
                          title={p.enabled ? 'Armed (click to disarm)' : 'Disarmed (click to arm)'}
                          aria-label={`Toggle ${p.name}`}
                        >
                          <Power size={11} />
                        </button>
                        <span className="meter-name">{p.name}</span>
                      </div>
                      <span className="pill-tag-subtle">{actionLabels[p.action] ?? p.action}</span>
                    </div>

                    <div className="meter-bar-track">
                      <div className="meter-bar-fill" style={{ width: `${pct}%` }} />
                      <div
                        className="meter-threshold-marker"
                        style={{ left: `${Math.round(p.sensitivity * 100)}%` }}
                        title={`Threshold: ${Math.round(p.sensitivity * 100)}%`}
                      />
                    </div>

                    <div className="meter-card-footer">
                      <span className="meter-pct tabular-nums">{pct}%</span>
                      <div className="row-inline">
                        <span className="meter-threshold text-muted text-xs tabular-nums">
                          gate {Math.round(p.sensitivity * 100)}%
                        </span>
                        <button
                          type="button"
                          className="btn-test-pulse"
                          onClick={() => onTriggerProfileAction(p)}
                          title={`Run ${actionLabels[p.action] ?? p.action} now`}
                        >
                          <Play size={10} />
                          <span>Test</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* Inline Trainer Panel */}
      {showTrainer && (
        <section className="trainer-panel" ref={trainerSectionRef}>
          <div className="trainer-header">
            <h3 className="panel-title">Train Personal Switch</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowTrainer(false)
                training.resetTraining()
              }}
            >
              Close
            </button>
          </div>

          <div className="stepper-bar">
            {['setup', 'baseline', 'signal', 'verify'].map((st, idx) => {
              const order = ['setup', 'baseline', 'signal', 'verify', 'done']
              const active = training.step === st
              const done = order.indexOf(training.step) > idx
              return (
                <div key={st} className={`step-item ${active ? 'current' : ''} ${done ? 'done' : ''}`}>
                  <span className="step-num">{idx + 1}</span>
                  <span className="step-name">{st.toUpperCase()}</span>
                </div>
              )
            })}
          </div>

          <div className="trainer-body">
            {training.step === 'setup' && (
              <div className="trainer-step-content">
                <div className="form-group">
                  <label className="input-label">1. Choose Movement Channel</label>
                  <p className="input-hint">
                    {signalNotes[training.signalKind as SignalKind] ||
                      'Pick a movement you can repeat comfortably. Simultaneous switches are isolated automatically.'}
                  </p>
                  <div className="choice-chips">
                    {AVAILABLE_SIGNALS.map((sig) => (
                      <button
                        key={sig}
                        type="button"
                        className={`chip ${training.signalKind === sig ? 'chip-active' : ''}`}
                        onClick={() => training.setSignalKind(sig)}
                      >
                        {signalLabels[sig]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="input-label">2. Action To Perform</label>
                  <div className="choice-chips">
                    {AVAILABLE_ACTIONS.map((act) => (
                      <button
                        key={act}
                        type="button"
                        className={`chip ${training.actionKind === act ? 'chip-active' : ''}`}
                        onClick={() => training.setActionKind(act)}
                      >
                        {actionLabels[act]}
                      </button>
                    ))}
                  </div>
                </div>

                {training.actionKind === 'launch-app' && (
                  <div className="form-group">
                    <label className="input-label">Target Application</label>
                    <select
                      className="select-input"
                      value={training.targetAppId}
                      onChange={(e) => training.setTargetAppId(e.target.value)}
                    >
                      {DEFAULT_APPS.map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {training.actionKind === 'key' && (
                  <div className="form-group">
                    <label className="input-label">Key Sequence (SendKeys format)</label>
                    <input
                      type="text"
                      className="text-input font-mono"
                      value={training.keyValue}
                      onChange={(e) => training.setKeyValue(e.target.value)}
                      placeholder="e.g. {ENTER}, {ESC}, ^{TAB}"
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="input-label">Switch Label (Optional)</label>
                  <input
                    type="text"
                    className="text-input"
                    value={training.signalName}
                    onChange={(e) => training.setSignalName(e.target.value)}
                    placeholder={`${signalLabels[training.signalKind as SignalKind]} → ${actionLabels[training.actionKind as ActionKind]}`}
                  />
                </div>

                <div className="trainer-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleStartCalibrationClick()}
                  >
                    <span>
                      {training.signalKind === 'finger-snap'
                        ? 'Start 2.5s Noise Floor Calibration'
                        : cameraState === 'ready'
                        ? 'Start 2.5s Resting Calibration'
                        : 'Enable Camera & Start Calibration'}
                    </span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {training.step === 'baseline' && (
              <div className="trainer-step-content text-center">
                <h4 className="step-title">
                  {training.signalKind === 'finger-snap'
                    ? 'Calibrating Ambient Microphone Noise'
                    : 'Calibrating Neutral Resting Face'}
                </h4>
                <p className="input-hint max-w-md mx-auto">
                  {training.signalKind === 'finger-snap'
                    ? 'Stay quiet for 2.5 seconds. Cuesta measures room acoustics so acoustic finger transients stand out cleanly.'
                    : 'Relax your face naturally for 2.5 seconds. Cuesta learns your resting neutral baseline so triggers measure intentional delta only.'}
                </p>

                <div className="baseline-progress-wrap">
                  <div
                    className="baseline-progress-bar"
                    style={{ width: `${Math.round(training.calibrationProgress * 100)}%` }}
                  />
                </div>
                <span className="tabular-nums font-mono text-sm text-secondary">
                  {Math.round(training.calibrationProgress * 100)}%
                </span>
              </div>
            )}

            {training.step === 'signal' && (
              <div className="trainer-step-content text-center">
                <h4 className="step-title">
                  {training.signalKind === 'finger-snap'
                    ? 'Teach Your Snap (3 Repetitions)'
                    : 'Teach Your Signal (3 Repetitions)'}
                </h4>
                <p className="input-hint max-w-md mx-auto">
                  {training.signalKind === 'finger-snap'
                    ? 'Snap your fingers clearly near your microphone 3 times. Acoustic transient spikes capture automatically.'
                    : <>Perform a clear <strong>{signalLabels[training.signalKind as SignalKind]}</strong> and relax back to neutral 3 times. Auto-peak captures automatically, or press <kbd>Space</kbd>.</>}
                </p>

                <div className="departure-meter-box max-w-md mx-auto">
                  <div className="mini-slider-row">
                    <span>Live Departure</span>
                    <span className="tabular-nums font-mono">{Math.round(training.liveDeparture * 100)}%</span>
                  </div>
                  <div className="meter-bar-track">
                    <div
                      className="meter-bar-fill"
                      style={{ width: `${Math.min(100, Math.round(training.liveDeparture * 100))}%` }}
                    />
                    <div className="meter-threshold-marker" style={{ left: '14%' }} title="Auto-peak trigger gate (14%)" />
                  </div>
                </div>

                {training.autoPeakNotice && (
                  <div className="auto-peak-badge">
                    <Zap size={13} />
                    <span>{training.autoPeakNotice}</span>
                  </div>
                )}

                <div className="repetition-dots">
                  {[1, 2, 3].map((num) => (
                    <div
                      key={num}
                      className={`rep-dot ${training.repetitions >= num ? 'rep-dot-done' : ''}`}
                    >
                      {training.repetitions >= num ? <CheckCircle2 size={16} /> : num}
                    </div>
                  ))}
                </div>

                <div className="trainer-actions justify-center">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => training.recordRepetition()}
                  >
                    <span>Manual Capture #{training.repetitions + 1} (or Space)</span>
                  </button>
                </div>
              </div>
            )}

            {training.step === 'verify' && (
              <div className="trainer-step-content">
                <div className="verify-top-row">
                  <div>
                    <h4 className="step-title">Test & Verify Trigger Before Saving</h4>
                    <p className="input-hint">
                      Perform your <strong>{signalLabels[training.signalKind as SignalKind]}</strong> now — watch the live meter cross the gate and confirm triggers below.
                    </p>
                  </div>
                  <div className={`verify-counter-pill ${verifyTriggers > 0 ? 'is-verified' : ''}`}>
                    <Zap size={12} />
                    <span className="tabular-nums">
                      {verifyTriggers > 0 ? `Trigger Verified (${verifyTriggers}x)` : 'Waiting for test movement'}
                    </span>
                  </div>
                </div>

                <LiveMeter
                  value={verifyScore}
                  threshold={training.sensitivity}
                  label={`Live ${signalLabels[training.signalKind as SignalKind]} Match`}
                />

                <div className="tuning-grid">
                  <div className="slider-group">
                    <div className="slider-header">
                      <span className="input-label">Sensitivity Gate</span>
                      <span className="tabular-nums font-mono text-xs">{Math.round(training.sensitivity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.25"
                      max="0.90"
                      step="0.02"
                      value={training.sensitivity}
                      onChange={(e) => training.setSensitivity(parseFloat(e.target.value))}
                      className="range-input"
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-header">
                      <span className="input-label">Hold Duration</span>
                      <span className="tabular-nums font-mono text-xs">{training.holdMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min="60"
                      max="900"
                      step="20"
                      value={training.holdMs}
                      onChange={(e) => training.setHoldMs(parseInt(e.target.value, 10))}
                      className="range-input"
                    />
                  </div>

                  <div className="slider-group">
                    <div className="slider-header">
                      <span className="input-label">Cooldown</span>
                      <span className="tabular-nums font-mono text-xs">{training.cooldownMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min="250"
                      max="1600"
                      step="50"
                      value={training.cooldownMs}
                      onChange={(e) => training.setCooldownMs(parseInt(e.target.value, 10))}
                      className="range-input"
                    />
                  </div>
                </div>

                <div className="trainer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onTriggerTestPulse(training.actionKind, training.keyValue, training.targetAppId)}
                  >
                    <Play size={13} />
                    <span>Simulate {actionLabels[training.actionKind as ActionKind]}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      training.saveSwitch()
                      setShowTrainer(false)
                    }}
                  >
                    <CheckCircle2 size={14} />
                    <span>Arm & Save Switch</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Switch Vault Table */}
      <section className="inventory-panel">
        <div className="inventory-header">
          <h3 className="panel-title">Trained Switches ({profiles.length})</h3>
          <div className="privacy-pill">
            <ShieldCheck size={13} className="text-accent" />
            <span>Saved locally</span>
          </div>
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Switch Name</th>
                <th>Channel</th>
                <th>Assigned Action</th>
                <th>Gate</th>
                <th>Hold</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      type="button"
                      className={`status-pill ${p.enabled ? 'status-pill-active' : 'status-pill-off'}`}
                      onClick={() => onToggleProfile(p.id)}
                    >
                      {p.enabled ? 'Armed' : 'Paused'}
                    </button>
                  </td>
                  <td className="font-medium text-primary">{p.name}</td>
                  <td>{signalLabels[p.signal]}</td>
                  <td>
                    <span className="pill-tag-subtle">
                      {actionLabels[p.action] ?? p.action}
                      {p.action === 'launch-app' && p.targetAppId ? ` (${p.targetAppId})` : ''}
                      {p.action === 'key' && p.key ? ` (${p.key})` : ''}
                    </span>
                  </td>
                  <td className="tabular-nums font-mono">{Math.round(p.sensitivity * 100)}%</td>
                  <td className="tabular-nums font-mono">{p.holdMs} ms</td>
                  <td>
                    <div className="row-inline">
                      <button
                        type="button"
                        className="btn-test-pulse"
                        onClick={() => onTriggerProfileAction(p)}
                        title="Test this action"
                      >
                        <Play size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-danger"
                        onClick={() => onDeleteProfile(p.id)}
                        title="Delete Switch"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
