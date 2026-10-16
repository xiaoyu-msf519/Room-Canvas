/** RoomCanvas uses meters, a right-handed coordinate system, and Y-up. */
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export type FurnitureKind = 'original' | 'imported'
export type GenerationStatus = 'needs_dimensions' | 'uploading' | 'generating' | 'scaling' | 'succeeded' | 'failed'
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
  generationStatus?: GenerationStatus
}

export interface SceneManifest {
  version: string
  units: 'meters'
  coordinateSystem: 'right-handed-y-up'
  room: {
    modelUrl?: string
    bounds: Vec3
    colliders?: SceneCollider[]
  }
  furniture: FurnitureItem[]
  cameras: Array<{
    id: string
    imageUrl?: string
    imageSize?: [number, number]
    intrinsics?: [number, number, number, number, number, number, number, number, number]
    cameraToWorld?: number[]
  }>
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
  stageMessage?: string
  error?: string
}
