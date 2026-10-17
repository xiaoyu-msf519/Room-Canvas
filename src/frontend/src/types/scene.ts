/** RoomCanvas uses meters, a right-handed coordinate system, and Y-up. */
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export type FurnitureKind = 'original' | 'imported'
export type GenerationStatus = 'pending' | 'queued' | 'needs_dimensions' | 'uploading' | 'generating' | 'scaling' | 'succeeded' | 'failed'
export type AssetSource = 'file' | 'clipboard' | 'drop' | 'url' | 'demo'

export interface SceneCollider {
  position: Vec3
  size: Vec3
  rotation: Quaternion
}

export interface FurnitureItem extends SceneCollider {
  id: string
  name: string
  kind: FurnitureKind
  modelUrl?: string
  editModelUrl?: string
  generationStatus?: GenerationStatus
  category?: string
  jobId?: string
  cropUrl?: string | null
  stageMessage?: string
  error?: string | null
  reviewRequired?: boolean
  originalBounds?: SceneCollider
}

export interface RoomSurface extends SceneCollider {
  id: string
  kind: 'wall' | 'floor'
  polygonCorners?: Vec3[]
}

export interface SceneManifest {
  id: string
  title: string
  version: string
  units: 'meters'
  coordinateSystem: 'right-handed-y-up'
  room: {
    modelUrl?: string
    bounds: Vec3
    colliders?: SceneCollider[]
    surfaces: RoomSurface[]
    min: Vec3
    max: Vec3
  }
  furniture: FurnitureItem[]
  cameras: Array<{
    id: string
    imageUrl?: string
    imageWidth?: number
    imageHeight?: number
    nativeImageWidth?: number
    nativeImageHeight?: number
    nativePixelToSavedPixel?: number[]
    imageSize?: [number, number]
    intrinsics?: [number, number, number, number, number, number, number, number, number]
    cameraToWorld?: number[]
  }>
  source: { worldOffset: Vec3; coordinateSystem: string; matrixLayout: string; scanId: string; orientation?: {
    reference: 'true-north' | 'magnetic-north'
    northInWorld: Vec3
    northAngleDegrees?: number
    accuracyDegrees: number
    sampleCount: number
    coherence: number
    utcOffsetMinutes?: number
    location?: { latitude: number; longitude: number }
  } | null }
  warnings: string[]
}

export interface UploadedAsset {
  id: string
  name: string
  previewUrl: string
  source: AssetSource
  status: GenerationStatus
  createdAt: number
  dimensionsMm?: {
    width: number
    depth: number
    height: number
  }
  jobId?: string
  modelUrl?: string
  editModelUrl?: string
  stageMessage?: string
  error?: string
}
