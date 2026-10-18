import { Box3, Group, Vector3, type Object3D } from 'three'

const measuredBounds = new WeakMap<Object3D, { center: Vector3; extents: Vector3 }>()

export function createModelDisplay(source: Object3D) {
  const display = source.clone(true)
  display.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return
    // Instances share immutable GLTF geometry, materials and textures.
    child.castShadow = true
    child.receiveShadow = true
  })
  let measured = measuredBounds.get(source)
  if (!measured) {
    const root = new Group()
    root.add(display)
    root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(root)
    measured = { center: bounds.getCenter(new Vector3()), extents: bounds.getSize(new Vector3()) }
    measuredBounds.set(source, measured)
    root.remove(display)
  }
  return { display, ...measured }
}
