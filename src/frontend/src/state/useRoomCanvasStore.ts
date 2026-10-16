import { create } from 'zustand'
import type { FurnitureItem, SceneCollider, UploadedAsset } from '../types/scene'

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
  setMode: (mode: RoomMode) => void
  setTransformMode: (mode: TransformMode) => void
  setShowWireframe: (show: boolean) => void
  setLightingPreset: (preset: LightingPreset) => void
  setSelectedId: (id: string | null) => void
  addUploadedAsset: (asset: UploadedAsset) => void
  removeUploadedAsset: (id: string) => void
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
  setMode: (mode) => set((state) => ({ mode, ...(mode === 'play' ? { selectedId: null } : { selectedId: state.selectedId }) })),
  setTransformMode: (transformMode) => set({ transformMode }),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setLightingPreset: (lightingPreset) => set({ lightingPreset }),
  setSelectedId: (selectedId) => set({ selectedId }),
  addUploadedAsset: (asset) => set((state) => ({ uploadedAssets: [asset, ...state.uploadedAssets] })),
  removeUploadedAsset: (id) => set((state) => ({ uploadedAssets: state.uploadedAssets.filter((asset) => asset.id !== id) })),
}))
