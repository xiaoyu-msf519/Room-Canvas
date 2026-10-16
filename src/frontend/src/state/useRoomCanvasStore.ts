import { create } from 'zustand'
import type { FurnitureItem, SceneCollider, UploadedAsset, Vec3 } from '../types/scene'

export type RoomMode = 'edit' | 'play'
export type TransformMode = 'translate' | 'rotate' | 'scale'
export type LightingPreset = 'morning' | 'sunset' | 'night'

interface RoomCanvasState {
  mode: RoomMode
  transformMode: TransformMode
  showWireframe: boolean
  lightingPreset: LightingPreset
  furnitureList: FurnitureItem[]
  roomColliders: SceneCollider[]
  selectedId: string | null
  uploadedAssets: UploadedAsset[]
  draggingAssetId: string | null
  placementPreview: Vec3 | null
  setMode: (mode: RoomMode) => void
  setTransformMode: (mode: TransformMode) => void
  setShowWireframe: (show: boolean) => void
  setLightingPreset: (preset: LightingPreset) => void
  setSelectedId: (id: string | null) => void
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
  transformMode: 'translate',
  showWireframe: true,
  lightingPreset: 'morning',
  furnitureList: [],
  roomColliders: [],
  selectedId: null,
  uploadedAssets: [],
  draggingAssetId: null,
  placementPreview: null,
  setMode: (mode) => set((state) => ({ mode, ...(mode === 'play' ? { selectedId: null } : { selectedId: state.selectedId }) })),
  setTransformMode: (transformMode) => set({ transformMode }),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setLightingPreset: (lightingPreset) => set({ lightingPreset }),
  setSelectedId: (selectedId) => set({ selectedId }),
  addUploadedAsset: (asset) => set((state) => state.uploadedAssets.some((current) => current.id === asset.id) ? state : ({ uploadedAssets: [asset, ...state.uploadedAssets] })),
  updateUploadedAsset: (id, patch) => set((state) => ({ uploadedAssets: state.uploadedAssets.map((asset) => asset.id === id ? { ...asset, ...patch } : asset) })),
  removeUploadedAsset: (id) => set((state) => ({ uploadedAssets: state.uploadedAssets.filter((asset) => asset.id !== id) })),
  addFurniture: (item) => set((state) => ({ furnitureList: [...state.furnitureList, item] })),
  updateFurniture: (id, patch) => set((state) => ({ furnitureList: state.furnitureList.map((item) => item.id === id ? { ...item, ...patch } : item) })),
  setDraggingAssetId: (draggingAssetId) => set({ draggingAssetId, placementPreview: null }),
  setPlacementPreview: (placementPreview) => set({ placementPreview }),
}))
