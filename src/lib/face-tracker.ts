import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export const BLENDSHAPE_NAMES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
  'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
  'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel',
  'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight',
  'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const

export interface FeatureFrame {
  features: number[]
  presence: number
  movement: number
}

function headPose(matrix: Float32Array | number[]): [number, number, number] {
  if (matrix.length < 11) return [0, 0, 0]
  const yaw = Math.atan2(matrix[8], matrix[10])
  const pitch = Math.atan2(-matrix[9], Math.sqrt(matrix[8] ** 2 + matrix[10] ** 2))
  const roll = Math.atan2(matrix[1], matrix[5])
  return [yaw / Math.PI, pitch / Math.PI, roll / Math.PI]
}

export function featuresFromResult(result: { faceBlendshapes?: Array<{ categories: Array<{ categoryName?: string; score?: number }> }>; facialTransformationMatrixes?: Array<{ data: Float32Array | number[] }> }): FeatureFrame | null {
  const first = result.faceBlendshapes?.[0]
  if (!first) return null
  const blendshapeMap = new Map(first.categories.map((category) => [category.categoryName ?? '', category.score ?? 0]))
  const blendshapes = BLENDSHAPE_NAMES.map((name) => blendshapeMap.get(name) ?? 0)
  const pose = headPose(result.facialTransformationMatrixes?.[0]?.data ?? [])
  const movement = Math.min(1, Math.sqrt(blendshapes.reduce((sum, value) => sum + value ** 2, 0) / blendshapes.length) * 2.2 + Math.abs(pose[0]) + Math.abs(pose[1]) + Math.abs(pose[2]))
  return { features: [...blendshapes, ...pose], presence: 1, movement }
}

export class LocalFaceTracker {
  private landmarker: FaceLandmarker | null = null
  private animationFrame = 0
  private stopped = false

  async initialize(): Promise<void> {
    const assetUrl = (relativePath: string) => new URL(relativePath, document.baseURI).toString()
    const vision = await FilesetResolver.forVisionTasks(assetUrl('wasm'))
    const options = {
      baseOptions: { modelAssetPath: assetUrl('models/face_landmarker.task') },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
    }
  }

  start(video: HTMLVideoElement, onFrame: (frame: FeatureFrame | null) => void): void {
    if (!this.landmarker) throw new Error('Face Landmarker has not been initialized.')
    this.stopped = false
    const tick = () => {
      if (this.stopped) return
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        try {
          const result = this.landmarker?.detectForVideo(video, performance.now())
          onFrame(result ? featuresFromResult(result) : null)
        } catch {
          onFrame(null)
        }
      }
      this.animationFrame = requestAnimationFrame(tick)
    }
    this.animationFrame = requestAnimationFrame(tick)
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.animationFrame)
    this.landmarker?.close()
    this.landmarker = null
  }
}
