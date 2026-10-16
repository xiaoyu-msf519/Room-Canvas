import { create } from 'zustand'
import type { FurnitureItem, SceneCollider, SceneManifest, UploadedAsset, Vec3 } from '../types/scene'

export type RoomMode = 'edit' | 'play'
export type LightingPreset = 'morning' | 'sunset' | 'night'

interface RoomCanvasState {
  mode: RoomMode
  showWireframe: boolean
  lightingPreset: LightingPreset
  furnitureList: FurnitureItem[]
  roomColliders: SceneCollider[]
  scan: SceneManifest | null
  applyScan: (scan: SceneManifest) => void
  selectedId: string | null
  isTransforming: boolean
  uploadedAssets: UploadedAsset[]
  draggingAssetId: string | null
  placementPreview: Vec3 | null
  setMode: (mode: RoomMode) => void
  setShowWireframe: (show: boolean) => void
  setLightingPreset: (preset: LightingPreset) => void
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
  lightingPreset: 'morning',
  furnitureList: [],
  roomColliders: [],
  scan: null,
  applyScan: (scan) => set((state) => {
    const sameScene = state.scan?.id === scan.id
    const originals = scan.furniture.map((item) => {
      const current = sameScene ? state.furnitureList.find((entry) => entry.id === item.id) : null
      return current ? { ...item, position: current.position, rotation: current.rotation, size: current.size } : item
    })
    return {
      scan, roomColliders: scan.room.colliders ?? [],
      furnitureList: [...originals, ...state.furnitureList.filter((item) => item.kind === 'imported')],
      ...(sameScene ? {} : { mode: 'edit', selectedId: null }),
    }
  }),
  selectedId: null,
  isTransforming: false,
  uploadedAssets: [],
  draggingAssetId: null,
  placementPreview: null,
  setMode: (mode) => set((state) => ({ mode, ...(mode === 'play' ? { selectedId: null } : { selectedId: state.selectedId }) })),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setLightingPreset: (lightingPreset) => set({ lightingPreset }),
  setSelectedId: (selectedId) => set({ selectedId }),
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
