import { useEffect } from 'react'
import { useRoomCanvasStore } from './useRoomCanvasStore'
import { saveRoomDraft } from './roomDrafts'
import { rememberRoomSession } from './roomDraftSession'

export function saveCurrentRoomDraft(): boolean {
  const state = useRoomCanvasStore.getState()
  rememberRoomSession(state)
  return saveRoomDraft(state.scan?.id ?? 'empty', state.furnitureList, state.deletedFurnitureIds)
}

// Capture the live editor before subsequent hot updates can recreate modules.
saveCurrentRoomDraft()

export function useRoomDraftSync() {
  useEffect(() => {
    saveCurrentRoomDraft()
    const unsubscribe = useRoomCanvasStore.subscribe((state, previous) => {
      rememberRoomSession(state)
      if (state.scan?.id !== previous.scan?.id || state.furnitureList !== previous.furnitureList) saveCurrentRoomDraft()
    })
    const save = () => { saveCurrentRoomDraft() }
    window.addEventListener('pagehide', save)
    return () => { unsubscribe(); window.removeEventListener('pagehide', save) }
  }, [])
}
