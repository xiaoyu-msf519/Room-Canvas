import { useEffect, useState } from 'react'
import { SceneCanvas } from './scene/SceneCanvas'
import { HudLayout } from './components/HudLayout'
import { useScanSync } from './state/useScanSync'
import { useSolarScanSync } from './state/useSolarScanSync'
import { useRoomDraftSync } from './state/useRoomDraftSync'

export default function App() {
  useRoomDraftSync()
  useScanSync()
  useSolarScanSync()
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <main className="roomcanvas-app">
      <SceneCanvas />
      <HudLayout onToast={setToast} />
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </main>
  )
}
