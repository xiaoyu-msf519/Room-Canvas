import { BoxGeometry, Matrix4, Mesh, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import { CSG } from 'three-csg-ts'
import { Node } from 'three-csg-ts/lib/esm/Node.js'
import type { Polygon } from 'three-csg-ts/lib/esm/Polygon.js'
import type { RoomSurface } from '../types/scene'

interface WallVisual {
  surface: RoomSurface
  material: MeshStandardMaterial
}

/** Split static walls once; BSP traversal gives exact back-to-front face order. */
export function createWallTransparency(walls: WallVisual[]) {
  const identity = new Matrix4()
  const polygons = walls.flatMap(({ surface }, index) => {
    // Scan door subtraction can leave sub-micrometer slivers at floor level.
    if (surface.size.some((size) => size < 0.00001)) return []
    const geometry = new BoxGeometry(...surface.size)
    const pose = new Mesh(geometry)
    pose.position.fromArray(surface.position)
    pose.quaternion.fromArray(surface.rotation)
    pose.updateMatrix()
    geometry.applyMatrix4(pose.matrix)
    const result = CSG.fromGeometry(geometry, index).toPolygons()
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
      const mesh = new Mesh(geometry, walls[index].material)
      mesh.name = 'scan-wall-fragment'
      mesh.receiveShadow = true
      mesh.userData.wallId = walls[index].surface.id
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
