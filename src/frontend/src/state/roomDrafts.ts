import type { FurnitureItem } from '../types/scene'

interface RoomDraft {
  version: 1
  furniture: FurnitureItem[]
  deletedFurnitureIds: string[]
}

const key = (sceneId: string) => `roomcanvas-room-draft-v1:${sceneId}`

export function readRoomDraft(sceneId: string): RoomDraft | null {
  try {
    const raw = localStorage.getItem(key(sceneId))
    if (!raw) return null
    const draft = JSON.parse(raw) as RoomDraft
    return draft.version === 1 && Array.isArray(draft.furniture) && Array.isArray(draft.deletedFurnitureIds) ? draft : null
  } catch { return null }
}

export function saveRoomDraft(sceneId: string, furniture: FurnitureItem[], deletedFurnitureIds: string[] = []): boolean {
  try {
    localStorage.setItem(key(sceneId), JSON.stringify({ version: 1, furniture, deletedFurnitureIds } satisfies RoomDraft))
    return true
  } catch { return false }
}
