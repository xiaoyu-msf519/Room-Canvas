import { create } from 'zustand'
import type { FurnitureItem, SceneCollider, SceneManifest, UploadedAsset, Vec3 } from '../types/scene'

export type RoomMode = 'edit' | 'play'

interface RoomCanvasState {
  mode: RoomMode
  showWireframe: boolean
  furnitureList: FurnitureItem[]
  roomColliders: SceneCollider[]
  scan: SceneManifest | null
  applyScan: (scan: SceneManifest) => void
  selectedId: string | null
  selectedSurfaceId: string | null
  setSelectedSurfaceId: (id: string | null) => void
  isTransforming: boolean
  uploadedAssets: UploadedAsset[]
  draggingAssetId: string | null
  placementPreview: Vec3 | null
  setMode: (mode: RoomMode) => void
  setShowWireframe: (show: boolean) => void
  setSelectedId: (id: string | null) => void
  setIsTransforming: (isTransforming: boolean) => void
  addUploadedAsset: (asset: UploadedAsset) => void
  updateUploadedAsset: (id: string, patch: Partial<UploadedAsset>) => void
  removeUploadedAsset: (id: string) => void
  addFurniture: (item: FurnitureItem) => void
  updateFurniture: (id: string, patch: Partial<FurnitureItem>) => void
  setDraggingAssetId: (id: string | null) => void
  setPlacementPreview: (position: Vec3 | null) => void
}

export const useRoomCanvasStore = create<RoomCanvasState>((set) => ({
  mode: 'edit',
  showWireframe: true,
  furnitureList: [],
  roomColliders: [],
  scan: null,
  applyScan: (scan) => set((state) => {
    const sameScene = state.scan?.id === scan.id
    if (sameScene && JSON.stringify(state.scan) === JSON.stringify(scan)) return state
    const originals = scan.furniture.map((item) => {
      const current = sameScene ? state.furnitureList.find((entry) => entry.id === item.id) : null
      if (!current) return item
      const merged = { ...item, position: current.position, rotation: current.rotation, size: current.size }
      return JSON.stringify(merged) === JSON.stringify(current) ? current : merged
    })
    const nextFurniture = [...originals, ...(sameScene ? state.furnitureList.filter((item) => item.kind === 'imported') : [])]
    const furnitureList = nextFurniture.length === state.furnitureList.length && nextFurniture.every((item, index) => item === state.furnitureList[index]) ? state.furnitureList : nextFurniture
    const room = sameScene && JSON.stringify(state.scan?.room) === JSON.stringify(scan.room) ? state.scan!.room : scan.room
    return {
      scan: room === scan.room ? scan : { ...scan, room }, roomColliders: room.colliders ?? [],
      furnitureList,
      ...(sameScene ? {} : { mode: 'edit', selectedId: null, selectedSurfaceId: null }),
    }
  }),
  selectedId: null,
  selectedSurfaceId: null,
  isTransforming: false,
  uploadedAssets: [],
  draggingAssetId: null,
  placementPreview: null,
  setMode: (mode) => set((state) => ({ mode, selectedId: mode === 'play' ? null : state.selectedId })),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setSelectedId: (selectedId) => set({ selectedId, selectedSurfaceId: null }),
  setSelectedSurfaceId: (selectedSurfaceId) => set({ selectedSurfaceId, selectedId: null }),
  setIsTransforming: (isTransforming) => set({ isTransforming }),
  addUploadedAsset: (asset) => set((state) => state.uploadedAssets.some((current) => current.id === asset.id) ? state : ({ uploadedAssets: [asset, ...state.uploadedAssets] })),
  updateUploadedAsset: (id, patch) => set((state) => ({ uploadedAssets: state.uploadedAssets.map((asset) => asset.id === id ? { ...asset, ...patch } : asset) })),
  removeUploadedAsset: (id) => set((state) => ({ uploadedAssets: state.uploadedAssets.filter((asset) => asset.id !== id) })),
  addFurniture: (item) => set((state) => ({ furnitureList: [...state.furnitureList, item] })),
  updateFurniture: (id, patch) => set((state) => ({ furnitureList: state.furnitureList.map((item) => item.id === id ? { ...item, ...patch } : item) })),
  setDraggingAssetId: (draggingAssetId) => set({ draggingAssetId, placementPreview: null }),
  setPlacementPreview: (placementPreview) => set((state) => {
    if (!placementPreview || !state.placementPreview) return { placementPreview }
    const same = Math.abs(state.placementPreview[0] - placementPreview[0]) < 0.01 && Math.abs(state.placementPreview[2] - placementPreview[2]) < 0.01
    return same ? state : { placementPreview }
  }),
}))
