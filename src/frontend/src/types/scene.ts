/** RoomCanvas uses meters, a right-handed coordinate system, and Y-up. */
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export type FurnitureKind = 'original' | 'imported'
export type GenerationStatus = 'pending' | 'preparing' | 'needs_review' | 'queued' | 'needs_dimensions' | 'uploading' | 'generating' | 'scaling' | 'succeeded' | 'failed'
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
  qualityWarning?: string | null
  originalBounds?: SceneCollider
}

export interface RoomSurface extends SceneCollider {
  id: string
  kind: 'wall' | 'floor' | 'ceiling'
  polygonCorners?: Vec3[]
  heightAlignment?: 'lowest-wall-top'
  finish?: {
    baseColor: string
    roughness: number
    method: 'rgbd-uniform-v1'
    sourceSurfaceId: string
    frameCount: number
    sampleCount: number
    coverage: number
  }
}

export interface SceneManifest {
  cache?: { restored?: boolean; folder?: string; warning?: string }
  pipeline?: {
    status: 'processing' | 'ready' | 'needs_attention' | 'idle'
    preparation: 'pending' | 'running' | 'complete' | 'failed'
    autoReconstruct: boolean
    stageMessage: string
    completed: number
    total: number
    failed: number
    needsReview: number
    preparing?: number
    queued?: number
    generating?: number
    scaling?: number
  }
  finishRecovery?: { method: 'rgbd-uniform-v1'; status: 'complete' | 'unavailable'; recoveredSurfaces: number }
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
    layout?: {
      templateId: string
      spawn: Vec3
      zones: Array<{ id: string; name: string; kind: 'living' | 'bedroom' | 'bathroom'; rect: [number, number, number, number]; center: Vec3; area: number }>
      doorways: Array<SceneCollider & { id: string; kind: 'doorway'; wallId: string; connects: [string, string] }>
    }
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
    materialTarget?: 'wall' | 'floor'
    photometry?: { exposureDurationSeconds?: number; exposureOffset?: number; ambientColorTemperatureKelvin?: number }
  }>
  source: { kind?: 'example-layout'; templateId?: string; worldOffset: Vec3; coordinateSystem: string; matrixLayout: string; scanId: string; orientation?: {
    reference: 'true-north' | 'magnetic-north'
    northInWorld: Vec3
    northAngleDegrees?: number
    accuracyDegrees: number
    sampleCount: number
    coherence: number
    sourceReference?: 'magnetic-north'
    magneticNorthInWorld?: Vec3
    correction?: { model: 'WMM2025'; declinationDegrees: number; uncertaintyDegrees: number; capturedAt: string; altitudeMeters: number }
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
