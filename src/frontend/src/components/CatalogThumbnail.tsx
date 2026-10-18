import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { retryImageUrl } from '../services/surfaceTextures'

export function CatalogThumbnail({ src, name, revision }: { src: string; name: string; revision: number }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const imageUrl = revision || attempt ? retryImageUrl(src, `${revision}-${attempt}`) : src
  return <>
    <img src={imageUrl} alt={name} width={224} height={224} decoding="async" draggable={false} hidden={failed} onError={() => { if (attempt < 1) setAttempt(attempt + 1); else setFailed(true) }} />
    {failed && <span className="resource-image-error" role="status"><ImageOff size={18} /><span>预览未载入</span></span>}
  </>
}
