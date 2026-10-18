export const CATALOG_DRAG_TYPE = 'application/x-roomcanvas-catalog'
export type CatalogKind = 'furniture' | 'wall' | 'floor'

export interface CatalogItem {
  id: string
  name: string
  category: string
  color: string
  texture: string
  kinds: CatalogKind[]
  thumbnailUrl: string
  imageUrl: string
  textureUrl: string
  coverageMeters: [number, number] | null
  coverageNote: string
  sizeOriginal: string | null
  source: string | null
  rights: string | null
}

export interface CatalogPage {
  items: CatalogItem[]
  total: number
  categories: string[]
  colors: string[]
  textures: string[]
  page: number
  pageSize: number
}

/** Resolve an opaque internal ID; never fetch a URL supplied by drag data. */
export async function catalogImageFile(itemId: string): Promise<File> {
  if (!/^furniture-\d{6}$/.test(itemId)) throw new Error('无效的家具资源')
  const details = await fetch(`/api/catalog/items/${itemId}`)
  if (!details.ok) throw new Error('无法读取资源信息')
  const item = await details.json() as CatalogItem
  const response = await fetch(`/api/catalog/items/${itemId}/image?variant=original`)
  if (!response.ok) throw new Error('无法读取资源图片')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('资源不是图片')
  return new File([blob], `${item.name.replace(/[\\/:*?"<>|]/g, '-')}-${itemId}.jpg`, { type: blob.type })
}
