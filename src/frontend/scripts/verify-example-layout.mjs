import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import React from 'react'
import { create } from '@react-three/test-renderer'
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
  assert.equal(zones.reduce((sum, zone) => sum + zone.area, 0), 120)
  const master = zones.find((zone) => zone.id === 'master'), ensuite = zones.find((zone) => zone.id === 'bath-ensuite')
  assert.equal(master.rect[1], ensuite.rect[3])
  assert.ok(Math.min(master.rect[2], ensuite.rect[2]) > Math.max(master.rect[0], ensuite.rect[0]))
  assert.equal(doorways.filter((door) => door.connects.includes('bath-ensuite')).length, 1)
  const suiteDoor = doorways.find((door) => door.connects.includes('bath-ensuite'))
  assert.ok(suiteDoor.connects.includes('master'))
  assert.ok(doorways.every((door) => door.size[0] >= 1 && door.size[1] === 2.2))
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
    const visited = new Set(['0,0']), queue = [[0, 0]]
    for (let index = 0; index < queue.length; index++) {
      const [x, z] = queue[index]
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`
        if (Math.abs(nx) > 60 || Math.abs(nz) > 50 || visited.has(key) || !canStandAt(nx / 10, nz / 10, colliders, floor)) continue
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
  assert.equal(canStandAt(7, 0, obstacles, floor), false)
  useRoomCanvasStore.getState().applyScan({ ...scene, id: 'prior-room' })
  useRoomCanvasStore.getState().addFurniture({ id: 'prior-import', kind: 'imported', name: 'old furniture', position: [0,1,0], size: [1,2,1], rotation: [0,0,0,1] })
  useRoomCanvasStore.getState().applyScan(scene)
  assert.deepEqual(useRoomCanvasStore.getState().furnitureList, [], 'A new independent room must not inherit imported furniture')
  renderer = await create(React.createElement(ScannedRoom))
  await renderer.advanceFrames(35, 1 / 60)
  const floors = renderer.scene.findAll((node) => node.instance.name === 'scan-floor')
  const ceilings = renderer.scene.findAll((node) => node.instance.name === 'scan-ceiling')
  assert.equal(floors.length, 6)
  assert.equal(ceilings.length, 6)
  assert.ok(ceilings.every((node) => node.instance.position.y === 2.8))
  assert.ok(renderer.scene.findAll((node) => node.instance.name === 'scan-wall').length > 0)
  renderer.scene.instance.updateMatrixWorld(true)
  const wallMeshes = renderer.scene.findAll((node) => node.instance.name === 'scan-wall').map((node) => node.instance)
  const panes = renderer.scene.findAll((node) => node.instance.name === 'room-window-glass')
  assert.equal(windows.length, 7)
  assert.equal(panes.length, windows.length)
  assert.equal(renderer.scene.findAll((node) => node.instance.name === 'room-window-frames').length, 1, 'Window frames must be batched')
  assert.ok(panes.every((node) => !node.instance.castShadow && node.instance.material.transparent), 'Glass must let sunlight through')
  const raycaster = new Raycaster()
  raycaster.far = 1
  for (const window of windows) {
    const rotation = new Quaternion(...window.rotation), center = new Vector3(...window.position)
    const normal = new Vector3(0, 0, 1).applyQuaternion(rotation)
    for (const u of [-0.3, 0, 0.3]) for (const v of [-0.25, 0, 0.25]) {
      const point = new Vector3(u * window.size[0], v * window.size[1], 0).applyQuaternion(rotation).add(center)
      raycaster.set(point.clone().addScaledVector(normal, -0.4), normal)
      assert.equal(raycaster.intersectObjects(wallMeshes, false).length, 0, `${window.id} has a wall blocking its aperture`)
    }
    const sill = center.y - window.size[1] / 2
    raycaster.set(new Vector3(center.x, sill - 0.2, center.z).addScaledVector(normal, -0.4), normal)
    assert.ok(raycaster.intersectObjects(wallMeshes, false).length > 0, `${window.id} has no solid sill`)
    assert.ok(obstacles.some((obstacle) => obstacle.containsPoint(center)), 'Closed glass needs a collision pane')
    assert.equal(canStandAt(center.x, center.z, obstacles, floor), false, 'A window must not become a walk-through opening')
  }
  console.log(`PASS: 3 bedrooms, living, 2 bathrooms; ${reachable.size} traversable 10cm cells, every internal doorway clear, ensuite reachable only through master; actual walls/floors/ceilings and empty scene isolation.`)
  console.log('PASS: 7 real window apertures (63 rays), preserved sills and glass collision, transparent sunlit panes and a single batched frame mesh.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
