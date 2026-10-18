import { Matrix4, Mesh, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import { CSG } from 'three-csg-ts'
import { Node } from 'three-csg-ts/lib/esm/Node.js'
import type { Polygon } from 'three-csg-ts/lib/esm/Polygon.js'
import type { RoomSurface } from '../types/scene'
import { createMetricWallGeometry } from './surfaceAppearance'
import { surfaceGroupId } from '../state/useSurfaceFinishStore'
import { wallFaceSurface } from './editableSurfaces'

interface WallVisual {
  surface: RoomSurface
  material: MeshStandardMaterial
  blendSlots?: MeshStandardMaterial[]
}

/** Split static walls once; BSP traversal gives exact back-to-front face order. */
export function createWallTransparency(walls: WallVisual[]) {
  const identity = new Matrix4()
  const slots: Array<{ wall: WallVisual; material: MeshStandardMaterial; surfaceId: string }> = []
  const polygons = walls.flatMap((wall) => {
    const { surface } = wall
    // Scan door subtraction can leave sub-micrometer slivers at floor level.
    if (surface.size.some((size) => size < 0.00001)) return []
    const reference = walls.find((wall) => surfaceGroupId(wall.surface) === surfaceGroupId(surface))!.surface
    const geometry = createMetricWallGeometry(surface, reference)
    const pose = new Mesh(geometry)
    pose.position.fromArray(surface.position)
    pose.quaternion.fromArray(surface.rotation)
    pose.updateMatrix()
    geometry.applyMatrix4(pose.matrix)
    const firstSlot = slots.length
    const materials = wall.blendSlots ?? [wall.material]
    materials.forEach((material, index) => slots.push({ wall, material, surfaceId: wallFaceSurface(surface, index === 2 ? 'negative' : 'positive').id }))
    geometry.groups.forEach((group) => { group.materialIndex = firstSlot + (surface.wallFaces ? group.materialIndex ?? 0 : 0) })
    const result = CSG.fromGeometry(geometry).toPolygons()
    geometry.dispose()
    return result
  })
  const tree = new Node(polygons)
  const meshes: Mesh[] = []
  const fragments = new Map<Node, Mesh[]>()
  const build = (node: Node | null) => {
    if (!node) return
    const byWall = new Map<number, Polygon[]>()
    for (const polygon of node.polygons) {
      const index = polygon.shared as number
      if (!byWall.has(index)) byWall.set(index, [])
      byWall.get(index)!.push(polygon)
    }
    const nodeMeshes = [...byWall].map(([index, faces]) => {
      const geometry = CSG.toGeometry(CSG.fromPolygons(faces), identity)
      const slot = slots[index]
      const mesh = new Mesh(geometry, slot.material)
      mesh.name = 'scan-wall-fragment'
      mesh.receiveShadow = true
      mesh.userData.wallId = slot.wall.surface.id
      mesh.userData.surfaceId = slot.surfaceId
      meshes.push(mesh)
      return mesh
    })
    fragments.set(node, nodeMeshes)
    build(node.front)
    build(node.back)
  }
  build(tree)
  const lastCamera = new Vector3(Infinity, Infinity, Infinity)
  return {
    meshes,
    syncOpaqueWalls(edit: boolean) {
      for (const mesh of meshes) mesh.visible = edit && (mesh.material as MeshStandardMaterial).opacity < 1
    },
    update(camera: Vector3) {
      if (camera.equals(lastCamera)) return
      lastCamera.copy(camera)
      let order = 1
      const visit = (node: Node | null) => {
        if (!node?.plane) return
        const { normal, w } = node.plane
        const inFront = normal.x * camera.x + normal.y * camera.y + normal.z * camera.z >= w
        visit(inFront ? node.back : node.front)
        for (const mesh of fragments.get(node)!) mesh.renderOrder = order++
        visit(inFront ? node.front : node.back)
      }
      visit(tree)
    },
    dispose() {
      meshes.forEach((mesh) => mesh.geometry.dispose())
    },
  }
}
