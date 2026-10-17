import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { create, act } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { Quaternion, Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { createWallFacing, createWallVisuals, isInsideFloor, wallOpacityAt, CUTAWAY_OPACITY } = await vite.ssrLoadModule('/src/scene/wallVisibility.ts')
  const { createWalkFloor } = await vite.ssrLoadModule('/src/scene/navigation.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const floorRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2).toArray()
  const floor = {
    id: 'floor', kind: 'floor', position: [0, 0, 0], rotation: floorRotation, size: [4, 4, 0.05],
    polygonCorners: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
  }
  // Deliberately use the same source normal for opposite walls: floor-based
  // interior correction must still make the near and far wall behave differently.
  const north = { id: 'north', kind: 'wall', position: [0, 1.5, 2], rotation: [0, 0, 0, 1], size: [4, 3, 0.1] }
  const south = { ...north, id: 'south', position: [0, 1.5, -2] }
  const ninety = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()
  const east = { ...north, id: 'east', position: [2, 1.5, 0], rotation: ninety }
  const west = { ...east, id: 'west', position: [-2, 1.5, 0] }
  const surfaces = [floor, north, south, east, west]
  const triangles = createWalkFloor(surfaces)
  const northFacing = createWallFacing(north, triangles)
  const southFacing = createWallFacing(south, triangles)
  assert.ok(northFacing.resolved && southFacing.resolved)
  assert.ok(northFacing.inward.dot(southFacing.inward) < -0.999, 'Opposite walls incorrectly share their interior direction')
  assert.equal(wallOpacityAt(northFacing, new Vector3(0, 2, 6), true, false), CUTAWAY_OPACITY)
  assert.equal(wallOpacityAt(southFacing, new Vector3(0, 2, 6), true, false), 1, 'Far wall must stay solid')
  assert.equal(wallOpacityAt(northFacing, new Vector3(0, 2, 6), false, false), 1)
  assert.equal(wallOpacityAt(northFacing, new Vector3(0, 2, 0), true, true), 1)
  assert.equal(createWallFacing(north, []).resolved, false)

  const visuals = createWallVisuals(surfaces)
  for (const [position, fadedIds] of [
    [[0, 4, 6], ['north']], [[0, 4, -6], ['south']],
    [[6, 4, 0], ['east']], [[-6, 4, 0], ['west']],
    [[6, 4, 6], ['north', 'east']], [[0, 1.7, 0], []], [[0, 8, 0], []],
  ]) {
    visuals.update(new Vector3(...position), true)
    const faded = visuals.walls.filter((wall) => wall.material.opacity < 1).map((wall) => wall.surface.id)
    assert.deepEqual(faded.sort(), [...fadedIds].sort(), `Wrong wall cutaway from ${position}`)
    for (const wall of visuals.walls) {
      assert.equal(wall.material.transparent, fadedIds.includes(wall.surface.id))
      assert.equal(wall.material.depthWrite, !fadedIds.includes(wall.surface.id))
    }
    visuals.update(new Vector3(...position), false)
    assert.ok(visuals.walls.every((wall) => wall.material.opacity === 1 && !wall.material.transparent && wall.material.depthWrite), 'Play wall is not opaque')
  }
  visuals.dispose()

  const concave = { ...floor, polygonCorners: [[-2, 2, 0], [2, 2, 0], [2, 0, 0], [0, 0, 0], [0, -2, 0], [-2, -2, 0]] }
  const concaveFloor = createWalkFloor([concave])
  assert.equal(isInsideFloor(new Vector3(1, 1.7, 1), concaveFloor), false)
  assert.equal(isInsideFloor(new Vector3(-1, 1.7, 1), concaveFloor), true)
  const notchWall = { ...north, position: [1, 1.5, 0], size: [2, 3, 0.1] }
  const notchFacing = createWallFacing(notchWall, concaveFloor)
  assert.ok(notchFacing.resolved && notchFacing.inward.z < -0.99, 'Concave notch uses an incorrect interior normal')

  let camera
  function CameraProbe() { camera = useThree((state) => state.camera); return null }
  useRoomCanvasStore.getState().applyScan({ id: 'wall-test', room: { surfaces, colliders: [] }, furniture: [] })
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(ScannedRoom), React.createElement(CameraProbe)), { camera: { position: [0, 4, 6] } })
  const walls = () => renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  const solid = walls()[0].instance.material
  await renderer.advanceFrames(2, 1 / 60)
  assert.equal(walls()[0].instance.material.opacity, CUTAWAY_OPACITY)
  assert.equal(walls()[1].instance.material.opacity, 1)
  camera.position.set(0, 4, -6)
  await renderer.advanceFrames(2, 1 / 60)
  assert.equal(walls()[0].instance.material.opacity, 1, 'Near/far walls did not swap after orbit')
  assert.equal(walls()[1].instance.material.opacity, CUTAWAY_OPACITY)
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls().every((wall) => wall.instance.material.opacity === 1 && wall.instance.material.depthWrite))
  await act(async () => useRoomCanvasStore.getState().setMode('edit'))
  await act(async () => useRoomCanvasStore.getState().applyScan({ id: 'wall-test', room: { surfaces: structuredClone(surfaces), colliders: [] }, furniture: [] }))
  assert.equal(walls()[0].instance.material, solid, 'Task polling reallocated wall materials')
  await renderer.unmount()
  renderer = null

  // Run the same camera updates against the real 30-panel scan, not only a cube.
  const actual = await fetch('http://127.0.0.1:8000/api/scenes/latest').then((response) => response.json())
  useRoomCanvasStore.getState().applyScan(actual)
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(ScannedRoom), React.createElement(CameraProbe)), { camera: { position: [8, 7, 8] } })
  const counts = []
  for (const [x, z] of [[8, 8], [-8, 8], [-8, -8], [8, -8]]) {
    camera.position.set(x, 7, z)
    await renderer.advanceFrames(2, 1 / 60)
    const faded = walls().filter((wall) => wall.instance.material.opacity < 0.999).length
    assert.ok(faded > 0 && faded < walls().length, `Real scan has all or no walls faded from ${x},${z}: ${faded}/${walls().length}`)
    counts.push(`${x},${z}: ${faded} faded / ${walls().length - faded} solid`)
  }
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls().every((wall) => wall.instance.material.opacity === 1 && !wall.instance.material.transparent))
  console.log(`PASS: Blueprint3D camera-side cutaway; opposing normals, orbit, interior camera, concave floor, depth writes, Play opacity, material reuse; actual scan: ${counts.join('; ')}`)
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
