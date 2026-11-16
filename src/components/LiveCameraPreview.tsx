import React, { useEffect, useRef } from 'react'
import { Camera, CameraOff } from 'lucide-react'

interface LiveCameraPreviewProps {
  stream: MediaStream | null
  className?: string
  mirrored?: boolean
  showBadge?: boolean
}

export function LiveCameraPreview({
  stream,
  className = '',
  mirrored = true,
  showBadge = true,
}: LiveCameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (stream && video.srcObject !== stream) {
      video.srcObject = stream
      video.play().catch(() => undefined)
    } else if (!stream && video.srcObject) {
      video.srcObject = null
    }
  }, [stream])

  return (
    <div className={`camera-preview-box ${className}`}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`camera-preview-video ${mirrored ? 'camera-preview-mirrored' : ''}`}
        />
      ) : (
        <div className="camera-preview-placeholder">
          <CameraOff size={28} className="camera-preview-icon text-muted" />
          <span className="camera-preview-label">Camera Standby</span>
        </div>
      )}

      {showBadge && (
        <div className="camera-preview-badge">
          <span className={`status-lamp ${stream ? 'active' : ''}`} />
          <span>{stream ? 'Live Optical Stream' : 'Offline'}</span>
        </div>
      )}
    </div>
  )
}
