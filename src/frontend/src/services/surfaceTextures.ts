import { TextureLoader, type Texture } from 'three'

interface TextureSource {
  base: Texture | null
  ready: Promise<Texture>
  users: number
  lastUsed: number
}

const sources = new Map<string, TextureSource>()
let accessOrder = 0

export function retryImageUrl(url: string, revision: string | number) {
  const parsed = new URL(url, 'http://roomcanvas.local')
  parsed.searchParams.set('retry', String(revision))
  return url.startsWith('/') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString()
}

function requestTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    let settled = false
    let texture: Texture | undefined
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      texture?.dispose()
      reject(new Error('贴图读取失败，请检查服务连接后重试'))
    }
    const timer = setTimeout(fail, 15000)
    try {
      texture = new TextureLoader().load(url, (result) => {
        if (settled) { result.dispose(); return }
        settled = true
        clearTimeout(timer)
        resolve(result)
      }, undefined, fail)
    } catch { fail() }
  })
}

async function loadTexture(url: string) {
  try { return await requestTexture(url) }
  catch {
    await new Promise((resolve) => setTimeout(resolve, 250))
    return requestTexture(retryImageUrl(url, Date.now()))
  }
}

function trimIdleSources() {
  const idle = [...sources].filter(([, entry]) => entry.users === 0 && entry.base).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  // Keep two decoded images warm for the handoff from preview to scene rendering.
  for (const [url, entry] of idle.slice(0, Math.max(0, idle.length - 2))) {
    entry.base!.dispose()
    sources.delete(url)
  }
}

export function acquireSurfaceTexture(url: string) {
  let entry = sources.get(url)
  if (!entry) {
    const created: TextureSource = { base: null, ready: loadTexture(url), users: 0, lastUsed: 0 }
    created.ready = created.ready.then((texture) => {
      created.base = texture
      trimIdleSources()
      return texture
    }, (error) => {
      // A rejected promise must never poison future attempts at the same image.
      if (sources.get(url) === created) sources.delete(url)
      throw error
    })
    sources.set(url, created)
    entry = created
  }
  const acquired = entry
  acquired.users++
  acquired.lastUsed = ++accessOrder
  let released = false
  return {
    ready: acquired.ready,
    release() {
      if (released) return
      released = true
      acquired.users--
      acquired.lastUsed = ++accessOrder
      trimIdleSources()
    },
  }
}
