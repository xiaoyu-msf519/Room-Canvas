import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { act, create } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = fileURLToPath(new URL('../../../', import.meta.url))
const python = path.join(root, 'env/backend/Scripts/python.exe')
const scene = JSON.parse(execFileSync(python, ['-c', "import sys,json; sys.path.insert(0,'src/backend'); from app.example_layout import create_example_layout; print(json.dumps(create_example_layout('examplewalkfixture')))"], { cwd: root, encoding: 'utf8' }))
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { Vector3, Quaternion, Raycaster } = await import('three')
  const { canStandAt, createWalkFloor, createWalkObstacles, findWalkSpawn } = await vite.ssrLoadModule('/src/scene/navigation.ts')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { zones, doorways, windows } = scene.room.layout
  assert.equal(zones.filter((zone) => zone.kind === 'bedroom').length, 3)
  assert.equal(zones.filter((zone) => zone.kind === 'bathroom').length, 2)
  assert.equal(zones.filter((zone) => zone.kind === 'living').length, 1)
  assert.equal(zones.filter((zone) => zone.kind === 'kitchen').length, 1)
  assert.equal(zones.filter((zone) => zone.kind === 'foyer').length, 1)
  assert.equal(zones.filter((zone) => zone.kind === 'balcony').length, 2)
  assert.ok(Math.abs(zones.reduce((sum, zone) => sum + zone.area, 0) - 115.66) < 1e-6)
  assert.ok(scene.room.layout.furniturePlan.length >= 28 && scene.furniture.length === 0, 'Furniture planning must stay metadata-only')
  const master = zones.find((zone) => zone.id === 'master'), ensuite = zones.find((zone) => zone.id === 'bath-ensuite')
  assert.equal(master.rect[0], ensuite.rect[2])
  assert.ok(Math.min(master.rect[3], ensuite.rect[3]) > Math.max(master.rect[1], ensuite.rect[1]))
  assert.equal(doorways.filter((door) => door.connects.includes('bath-ensuite')).length, 1)
  const suiteDoor = doorways.find((door) => door.connects.includes('bath-ensuite'))
  assert.ok(suiteDoor.connects.includes('master'))
  assert.ok(doorways.every((door) => door.size[0] >= 0.8 && door.size[1] === 2.2))
  const floor = createWalkFloor(scene.room.surfaces)
  const obstacles = createWalkObstacles(scene.room.colliders)
  const spawn = findWalkSpawn(obstacles, floor)
  assert.ok(spawn && spawn.y === 1.5 && canStandAt(spawn.x, spawn.z, obstacles, floor))
  for (const door of doorways.filter((item) => !item.connects.includes('outside'))) {
    const normal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...door.rotation))
    for (let step = -6; step <= 6; step++) {
      const point = new Vector3(...door.position).addScaledVector(normal, step * 0.1)
      assert.ok(canStandAt(point.x, point.z, obstacles, floor), `${door.id} is blocked at ${point.x},${point.z}; floor=${floor.some((triangle) => triangle.containsPoint(new Vector3(point.x, 0, point.z)))}`)
    }
  }
  function flood(colliders) {
    const start = [Math.round(spawn.x * 10), Math.round(spawn.z * 10)]
    const visited = new Set([start.join(',')]), queue = [start]
    for (let index = 0; index < queue.length; index++) {
      const [x, z] = queue[index]
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`
        if (nx < scene.room.min[0] * 10 || nx > scene.room.max[0] * 10 || nz < scene.room.min[2] * 10 || nz > scene.room.max[2] * 10 || visited.has(key) || !canStandAt(nx / 10, nz / 10, colliders, floor)) continue
        visited.add(key); queue.push([nx, nz])
      }
    }
    return visited
  }
  const reachable = flood(obstacles)
  for (const zone of zones) assert.ok(reachable.has(`${Math.round(zone.center[0] * 10)},${Math.round(zone.center[2] * 10)}`), `${zone.name} is unreachable in Play`)
  const blockedSuite = flood(createWalkObstacles([...scene.room.colliders, { position: suiteDoor.position, rotation: suiteDoor.rotation, size: suiteDoor.size }]))
  assert.ok(!blockedSuite.has(`${Math.round(ensuite.center[0] * 10)},${Math.round(ensuite.center[2] * 10)}`), 'Ensuite has an unintended second entrance')
  assert.ok(blockedSuite.has(`${Math.round(master.center[0] * 10)},${Math.round(master.center[2] * 10)}`))
  assert.equal(canStandAt(13, 0, obstacles, floor), false)
  assert.equal(canStandAt(10, -2, obstacles, floor), false, 'South of the living room must remain outdoors')
  assert.equal(canStandAt(4, 5.3, obstacles, floor), true, 'Central foyer is missing from the navigable floor')
  assert.equal(canStandAt(7, -0.5, obstacles, floor), true, 'South enclosed balcony is not walkable')
  for (const zone of zones.filter((zone) => zone.kind === 'bedroom' || zone.kind === 'kitchen')) assert.ok(windows.some((window) => window.zoneId === zone.id))
  assert.ok(!windows.some((window) => window.zoneId === 'foyer'))
  assert.equal(windows.filter((window) => window.zoneId.startsWith('balcony-') && window.enclosure).length, 6)
  useRoomCanvasStore.getState().applyScan({ ...scene, id: 'prior-room' })
  useRoomCanvasStore.getState().addFurniture({ id: 'prior-import', kind: 'imported', name: 'old furniture', position: [0,1,0], size: [1,2,1], rotation: [0,0,0,1] })
  useRoomCanvasStore.getState().applyScan(scene)
  assert.deepEqual(useRoomCanvasStore.getState().furnitureList, [], 'A new independent room must not inherit imported furniture')
  renderer = await create(React.createElement(ScannedRoom))
  await renderer.advanceFrames(35, 1 / 60)
  const floors = renderer.scene.findAll((node) => node.instance.name === 'scan-floor')
  const ceilings = renderer.scene.findAll((node) => node.instance.name === 'scan-ceiling')
  assert.equal(floors.length, zones.length)
  assert.equal(ceilings.length, zones.length)
  assert.equal(new Set(floors.map((node) => node.instance.userData.surfaceId)).size, zones.length)
  assert.ok(ceilings.every((node) => node.instance.position.y === 2.8))
  const ceilingInstances = ceilings.map((node) => node.instance)
  assert.ok(ceilingInstances.every((mesh) => !mesh.visible && !mesh.castShadow), 'Edit must have no visible ceiling or ceiling shadow')
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(ceilingInstances.every((mesh) => mesh.visible && mesh.castShadow && mesh.receiveShadow && !mesh.material.transparent && mesh.material.opacity === 1), 'Play must restore a solid ceiling and its shadows')
  assert.deepEqual(renderer.scene.findAll((node) => node.instance.name === 'scan-ceiling').map((node) => node.instance), ceilingInstances, 'Mode switching must reuse ceiling meshes')
  await act(async () => useRoomCanvasStore.getState().setMode('edit'))
  assert.ok(ceilingInstances.every((mesh) => !mesh.visible && !mesh.castShadow), 'Returning to Edit must hide the ceiling again')
  assert.ok(renderer.scene.findAll((node) => node.instance.name === 'scan-wall').length > 0)
  renderer.scene.instance.updateMatrixWorld(true)
  const wallMeshes = renderer.scene.findAll((node) => node.instance.name === 'scan-wall').map((node) => node.instance)
  const panes = renderer.scene.findAll((node) => node.instance.name === 'room-window-glass')
  assert.equal(windows.length, 14)
  assert.equal(panes.length, windows.length)
  assert.equal(renderer.scene.findAll((node) => node.instance.name === 'room-window-frames').length, 1, 'Window frames must be batched')
  assert.ok(panes.every((node) => !node.instance.castShadow && node.instance.material.transparent), 'Glass must let sunlight through')
  const raycaster = new Raycaster()
  raycaster.far = 0.24
  for (const window of windows) {
    const rotation = new Quaternion(...window.rotation), center = new Vector3(...window.position)
    const normal = new Vector3(0, 0, 1).applyQuaternion(rotation)
    for (const u of [-0.3, 0, 0.3]) for (const v of [-0.25, 0, 0.25]) {
      const point = new Vector3(u * window.size[0], v * window.size[1], 0).applyQuaternion(rotation).add(center)
      raycaster.set(point.clone().addScaledVector(normal, -0.12), normal)
      assert.equal(raycaster.intersectObjects(wallMeshes, false).length, 0, `${window.id} has a wall blocking its aperture`)
    }
    const sill = center.y - window.size[1] / 2
    raycaster.set(new Vector3(center.x, Math.max(0.02, sill / 2), center.z).addScaledVector(normal, -0.12), normal)
    assert.ok(raycaster.intersectObjects(wallMeshes, false).length > 0, `${window.id} has no solid sill`)
    assert.ok(obstacles.some((obstacle) => obstacle.containsPoint(center)), 'Closed glass needs a collision pane')
    assert.equal(canStandAt(center.x, center.z, obstacles, floor), false, 'A window must not become a walk-through opening')
  }
  console.log(`PASS: image-reference 3 bedrooms, living, 2 bathrooms, kitchen, central foyer and two enclosed balconies; ${reachable.size} traversable 10cm cells, every doorway clear, private ensuite, outdoor recesses preserved, independent floors/ceilings and empty furniture.`)
  console.log('PASS: 14 real window apertures, 3 glazed sides per balcony, no foyer windows, bedroom/kitchen windows, preserved sills/glass collision and a single batched frame mesh.')
  console.log('PASS: Edit hides ceiling and shadows, Play restores opaque ceilings, mode switches retain existing mesh instances.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
