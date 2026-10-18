import assert from 'node:assert/strict'
import React from 'react'
import { createRequire } from 'node:module'
import { create, act } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { Box3, Matrix4, Quaternion, Vector3 } = createRequire(import.meta.url)('three')
const roomLibrary = await fetch('http://127.0.0.1:8000/api/room-library').then((r) => r.json())
const scannedRoom = roomLibrary.rooms.find((room) => room.kind !== 'example-layout' && room.status === 'complete')
if (!scannedRoom) throw new Error('verify:scan requires at least one scanned room in the room library')
const scene = await fetch(`http://127.0.0.1:8000/api/room-library/${scannedRoom.id}/load`, { method: 'POST' }).then((r) => r.json())
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { createWalkFloor, createWalkObstacles, findWalkSpawn, canStandAt } = await vite.ssrLoadModule('/src/scene/navigation.ts')
  useRoomCanvasStore.getState().applyScan(scene)
  renderer = await create(React.createElement(ScannedRoom))
  renderer.scene.instance.updateMatrixWorld(true)
  const walls = renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  const floors = renderer.scene.findAll((node) => node.instance.name === 'scan-floor')
  const ceilings = renderer.scene.findAll((node) => node.instance.name === 'scan-ceiling')
  assert.equal(walls.length, scene.room.surfaces.filter((item) => item.kind === 'wall').length)
  assert.equal(floors.length, 1)
  assert.equal(ceilings.length, scene.room.surfaces.filter((item) => item.kind === 'ceiling').length)
  assert.ok(ceilings.length === 1 && ceilings[0].instance.position.y > floors[0].instance.position.y + 1, 'Ceiling is missing or below the room')
  const floorBounds = new Box3().setFromObject(floors[0].instance, true)
  assert.ok(Math.abs(floorBounds.min.y) < 0.0001 && Math.abs(floorBounds.max.y) < 0.0001, 'Floor is not at Y=0')
  const sourceFloor = scene.room.surfaces.find((surface) => surface.kind === 'floor')
  if (sourceFloor.finish) assert.equal(floors[0].instance.material.color.getHexString(), sourceFloor.finish.baseColor.slice(1), 'Recovered floor paint was not applied')
  const sourceWalls = scene.room.surfaces.filter((surface) => surface.kind === 'wall')
  const originalWallTops = new Map()
  for (const surface of sourceWalls) {
    const sourceId = surface.id.replace(/-\d+$/, '')
    const top = surface.position[1] + new Vector3(0, surface.size[1] / 2, 0).applyQuaternion(new Quaternion(...surface.rotation)).y
    originalWallTops.set(sourceId, Math.max(originalWallTops.get(sourceId) ?? -Infinity, top))
  }
  const lowestWallTop = Math.min(...originalWallTops.values())
  const sourceCeiling = scene.room.surfaces.find((surface) => surface.kind === 'ceiling')
  assert.equal(sourceCeiling.heightAlignment, 'lowest-wall-top', 'Ceiling height migration was not applied')
  assert.ok(Math.abs(sourceCeiling.position[1] - lowestWallTop) < 0.0001, 'Ceiling must align with the lowest original wall, not a door fragment')
  for (const [index, wall] of walls.entries()) {
    const source = sourceWalls[index]
    if (source.finish) assert.equal(wall.instance.material.color.getHexString(), source.finish.baseColor.slice(1), 'Recovered wall paint was not applied')
  }
  const floorPose = new Matrix4().compose(new Vector3(...sourceFloor.position), new Quaternion(...sourceFloor.rotation), new Vector3(1, 1, 1))
  const expectedFloorBounds = new Box3().setFromPoints(sourceFloor.polygonCorners.map(([x, y]) => new Vector3(x, y, 0).applyMatrix4(floorPose)))
  assert.ok(floorBounds.min.distanceTo(expectedFloorBounds.min) < 0.0001 && floorBounds.max.distanceTo(expectedFloorBounds.max) < 0.0001, 'Floor dimensions or pose differ from the scan contract')
  assert.ok(floorBounds.getSize(new Vector3()).length() > 0.1, 'Room geometry is blank')
  const colliders = createWalkObstacles([...scene.room.colliders, ...scene.furniture])
  const floor = createWalkFloor(scene.room.surfaces)
  const spawn = findWalkSpawn(colliders, floor)
  assert.ok(spawn, 'There is no valid walk spawn in the scanned room')
  assert.equal(spawn.y, 1.5, 'Play spawn must be 1.5m above the floor')
  assert.ok(canStandAt(spawn.x, spawn.z, colliders, floor))
  assert.equal(canStandAt(100, 100, colliders, floor), false)
  const wall = scene.room.colliders[0]
  assert.equal(canStandAt(wall.position[0], wall.position[2], colliders, floor), false, 'Wall collision is not active')

  // A reconstruction poll must update model URLs without undoing edits.
  const item = scene.furniture[0]
  const moved = [1.1, item.position[1], 0.9]
  const rotated = [0, Math.sin(0.4), 0, Math.cos(0.4)]
  useRoomCanvasStore.getState().updateFurniture(item.id, { position: moved, rotation: rotated })
  const updated = structuredClone(scene)
  updated.furniture[0].modelUrl = '/api/assets/test-completed.glb'
  updated.furniture[0].generationStatus = 'succeeded'
  await act(async () => useRoomCanvasStore.getState().applyScan(updated))
  const actual = useRoomCanvasStore.getState().furnitureList[0]
  assert.deepEqual(actual.position, moved)
  assert.deepEqual(actual.rotation, rotated)
  assert.equal(actual.modelUrl, '/api/assets/test-completed.glb')
  console.log(`PASS: actual ScannedRoom, ${walls.length} wall panels, polygon floor at Y=0; valid spawn/collisions, persistent edits during model replacement.`)
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
