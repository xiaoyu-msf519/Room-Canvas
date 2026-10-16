/** RoomCanvas uses meters, a right-handed coordinate system, and Y-up. */
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export type FurnitureKind = 'original' | 'imported'
export type GenerationStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed'
export type AssetSource = 'file' | 'clipboard' | 'drop' | 'url'

export interface FurnitureItem {
  id: string
  name: string
  kind: FurnitureKind
  position: Vec3
  size: Vec3
  rotation: Quaternion
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
}
