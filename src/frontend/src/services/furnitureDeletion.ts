import { useRoomCanvasStore } from '../state/useRoomCanvasStore'

export function confirmFurnitureDeletion(): boolean {
  const state = useRoomCanvasStore.getState()
  const item = state.furnitureList.find((entry) => entry.id === state.selectedId)
  if (typeof window === 'undefined' || state.mode !== 'edit' || state.isTransforming || !item) return false
  if (!window.confirm(`确认从当前房间删除“${item.name}”吗？\n已生成的模型和商品资产仍会保留。`)) return false
  const current = useRoomCanvasStore.getState()
  if (current.scan?.id !== state.scan?.id || current.mode !== 'edit' || current.isTransforming) return false
  current.removeFurniture(item.id)
  return true
}

export function handleFurnitureDeleteKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !['Delete', 'Backspace'].includes(event.key)) return
  const target = event.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return
  if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return
  const state = useRoomCanvasStore.getState()
  if (state.mode !== 'edit' || state.isTransforming || !state.selectedId) return
  event.preventDefault()
  confirmFurnitureDeletion()
}
