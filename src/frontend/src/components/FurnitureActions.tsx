import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { useRoomCanvasStore } from '../state/useRoomCanvasStore'
import { confirmFurnitureDeletion, handleFurnitureDeleteKey } from '../services/furnitureDeletion'

export function FurnitureActions() {
  const mode = useRoomCanvasStore((state) => state.mode)
  const selected = useRoomCanvasStore((state) => state.furnitureList.find((item) => item.id === state.selectedId))
  const transforming = useRoomCanvasStore((state) => state.isTransforming)
  useEffect(() => {
    window.addEventListener('keydown', handleFurnitureDeleteKey)
    return () => window.removeEventListener('keydown', handleFurnitureDeleteKey)
  }, [])
  if (mode !== 'edit' || !selected) return null
  return <div className="furniture-actions glass-panel" aria-label="选中家具操作">
    <span title={selected.name}>{selected.name}</span>
    <button type="button" disabled={transforming} aria-label="删除选中家具" title="删除家具（Delete）" onClick={confirmFurnitureDeletion}><Trash2 size={16} /></button>
  </div>
}
