import type { FurnitureItem, SceneCollider, SceneManifest, UploadedAsset } from '../types/scene'

interface RoomSession {
  mode: 'edit' | 'play'
  showWireframe: boolean
  scan: SceneManifest | null
  furnitureList: FurnitureItem[]
  roomColliders: SceneCollider[]
  selectedId: string | null
  selectedSurfaceId: string | null
  uploadedAssets: UploadedAsset[]
  deletedFurnitureIds?: string[]
}

let session: RoomSession | undefined

export function rememberRoomSession(state: RoomSession) {
  session = {
    mode: state.mode, showWireframe: state.showWireframe, scan: state.scan,
    furnitureList: state.furnitureList, roomColliders: state.roomColliders,
    selectedId: state.selectedId, selectedSurfaceId: state.selectedSurfaceId,
    uploadedAssets: state.uploadedAssets, deletedFurnitureIds: state.deletedFurnitureIds ?? [],
  }
}

export const readRoomSession = () => session
