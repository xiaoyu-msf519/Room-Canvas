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
  const { createWallFacing, createWallOccluder, createWallVisuals, isInsideFloor, wallOpacityAt, CUTAWAY_OPACITY, WALL_FADE_SECONDS } = await vite.ssrLoadModule('/src/scene/wallVisibility.ts')
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
  const northCamera = new Vector3(0, 4, 6)
  const southCamera = new Vector3(0, 4, -6)
  const fadingNorth = visuals.walls[0].material
  visuals.update(northCamera, true)
  assert.equal(fadingNorth.opacity, 1, 'Visibility change jumped to the target instead of fading')
  visuals.advance(0.1)
  const partial = fadingNorth.opacity
  assert.ok(partial < 1 && partial > CUTAWAY_OPACITY, 'Intermediate fade-out opacity is missing')
  assert.equal(fadingNorth.transparent, true)
  assert.equal(fadingNorth.depthWrite, false)
  visuals.advance(WALL_FADE_SECONDS - 0.1)
  assert.equal(fadingNorth.opacity, CUTAWAY_OPACITY, 'Stationary camera prevented the fade from completing')
  visuals.update(southCamera, true)
  assert.equal(fadingNorth.opacity, CUTAWAY_OPACITY, 'Fade-in jumped on start')
  visuals.advance(0.25)
  assert.ok(fadingNorth.opacity > CUTAWAY_OPACITY && fadingNorth.opacity < 1)
  assert.equal(fadingNorth.depthWrite, false, 'Edit wall changed its depth behavior during the fade')
  const interrupted = fadingNorth.opacity
  visuals.update(northCamera, true)
  assert.equal(fadingNorth.opacity, interrupted, 'Reversing the camera restarted the opacity from an endpoint')
  visuals.advance(0.01)
  assert.ok(fadingNorth.opacity < interrupted, 'Interrupted fade did not change direction')
  visuals.advance(0.49)
  assert.equal(fadingNorth.opacity, CUTAWAY_OPACITY)
  visuals.update(southCamera, true)
  visuals.advance(WALL_FADE_SECONDS)
  assert.equal(fadingNorth.opacity, 1)
  assert.equal(fadingNorth.transparent, true, 'Fade endpoint moved the Edit wall into the opaque render queue')
  assert.equal(fadingNorth.depthWrite, false, 'Fade endpoint changed Edit wall depth writes')
  visuals.update(northCamera, true)
  visuals.advance(0.1)
  visuals.update(northCamera, false)
  assert.ok(visuals.walls.every((wall) => wall.material.opacity === 1 && wall.material.depthWrite), 'Play did not cancel an unfinished fade immediately')
  visuals.advance(1)
  assert.ok(visuals.walls.every((wall) => wall.material.opacity === 1), 'Cancelled Edit fade leaked into Play')
  visuals.update(northCamera, true)
  visuals.advance(0.1, true)
  assert.ok(fadingNorth.opacity > CUTAWAY_OPACITY && fadingNorth.opacity < 1)
  visuals.advance(0.1, true)
  assert.equal(fadingNorth.opacity, CUTAWAY_OPACITY, 'Reduced-motion fade did not finish in 0.2s')
  for (const fps of [30, 60, 120]) {
    const sample = createWallVisuals(surfaces)
    sample.update(northCamera, true)
    const versions = sample.walls.map((wall) => wall.material.version)
    const assertStablePipeline = (frame) => {
      sample.walls.forEach(({ material }, index) => {
        assert.equal(material.transparent, true, `Edit render queue changed at ${fps}fps, frame ${frame}`)
        assert.equal(material.depthWrite, false, `Edit depth writes changed at ${fps}fps, frame ${frame}`)
        assert.equal(material.version, versions[index], `Fade invalidated the material shader at ${fps}fps, frame ${frame}`)
      })
    }
    assertStablePipeline('initial')
    for (const [camera, target] of [[northCamera, CUTAWAY_OPACITY], [southCamera, 1], [northCamera, CUTAWAY_OPACITY], [southCamera, 1]]) {
      sample.update(camera, true)
      let previous = sample.walls[0].material.opacity
      // Include the frame before completion, completion, and settled frames.
      for (let frame = 0; frame < fps / 2 + 3; frame++) {
        sample.update(camera, true)
        sample.advance(1 / fps)
        assertStablePipeline(frame)
        const opacity = sample.walls[0].material.opacity
        assert.ok(Math.abs(opacity - previous) <= (1 - CUTAWAY_OPACITY) * 3 / (fps * WALL_FADE_SECONDS) + 1e-8, 'Opacity jumped between animation frames')
        previous = opacity
        if (frame === fps / 2 - 1) assert.equal(opacity, target, `Fade duration depends on frame rate: ${fps}fps`)
      }
    }
    sample.dispose()
  }
  for (const [position, fadedIds] of [
    [[0, 4, 6], ['north']], [[0, 4, -6], ['south']],
    [[6, 4, 0], ['east']], [[-6, 4, 0], ['west']],
    [[6, 4, 6], ['north', 'east']], [[0, 1.7, 0], []], [[0, 8, 0], []],
  ]) {
    visuals.update(new Vector3(...position), true)
    visuals.advance(WALL_FADE_SECONDS)
    const faded = visuals.walls.filter((wall) => wall.material.opacity < 1).map((wall) => wall.surface.id)
    assert.deepEqual(faded.sort(), [...fadedIds].sort(), `Wrong wall cutaway from ${position}`)
    for (const wall of visuals.walls) {
      assert.equal(wall.material.transparent, true)
      assert.equal(wall.material.depthWrite, false)
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

  // L room: a camera-to-room segment crosses three sides of the S-shaped
  // boundary. Its middle wall faces the camera but still hides the other wing.
  const sFloor = {
    ...floor, size: [8, 6, 0.05],
    polygonCorners: [[-4, -3], [4, -3], [4, -1], [-1, -1], [-1, 3], [-4, 3]].map(([x, z]) => [x, -z, 0]),
  }
  const sWalls = [
    { ...north, id: 's-first', position: [-2.5, 2, 3], size: [3, 4, 0.1] },
    { ...east, id: 's-middle', position: [-1, 2, 1], size: [4, 4, 0.1] },
    { ...north, id: 's-last', position: [1.5, 2, -1], size: [5, 4, 0.1] },
    { ...south, id: 's-back', position: [0, 2, -3], size: [8, 4, 0.1] },
    { ...west, id: 's-left', position: [-4, 2, 0], size: [6, 4, 0.1] },
    { ...east, id: 's-right', position: [4, 2, -2], size: [2, 4, 0.1] },
  ]
  const sCamera = new Vector3(-6, 5, 6)
  const sTarget = new Vector3(3, 0.6, -2)
  const sSurfaces = [sFloor, ...sWalls]
  const sTriangles = createWalkFloor(sSurfaces)
  const middleFacing = createWallFacing(sWalls[1], sTriangles)
  assert.equal(wallOpacityAt(middleFacing, sCamera, true, false), 1, 'Fixture does not reproduce the normal-only failure')
  for (const wall of sWalls.slice(0, 3)) {
    assert.ok(createWallOccluder(wall).blocks(sCamera, sTarget), `${wall.id} did not intersect the finite room segment`)
  }
  const backOccluder = createWallOccluder(sWalls[3])
  assert.equal(backOccluder.blocks(sCamera, sTarget), false, 'Segment extended beyond the interior target and faded the back wall')
  const sVisuals = createWallVisuals(sSurfaces)
  sVisuals.update(sCamera, true)
  sVisuals.advance(WALL_FADE_SECONDS)
  for (const wall of sVisuals.walls.slice(0, 3)) assert.equal(wall.material.opacity, CUTAWAY_OPACITY, `${wall.surface.id} remains opaque across the L-room corner`)
  assert.equal(sVisuals.walls[3].material.opacity, 1, 'L-room rear boundary became transparent')
  sVisuals.update(sCamera, false)
  assert.ok(sVisuals.walls.every((wall) => wall.material.opacity === 1 && wall.material.depthWrite), 'L-room walls are not solid in Play')
  sVisuals.dispose()

  // Arbitrarily rotated OBBs and endpoint rules use the same finite-ray logic.
  const fortyFive = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
  const rotatedPanel = { ...north, position: [1, 2, 1], size: [2, 4, 0.1], rotation: fortyFive.toArray() }
  const rotatedOccluder = createWallOccluder(rotatedPanel)
  const panelCenter = new Vector3(...rotatedPanel.position)
  const panelNormal = new Vector3(0, 0, 1).applyQuaternion(fortyFive)
  assert.ok(rotatedOccluder.blocks(panelCenter.clone().addScaledVector(panelNormal, 3), panelCenter.clone().addScaledVector(panelNormal, -3)))
  assert.equal(rotatedOccluder.blocks(panelCenter.clone().addScaledVector(panelNormal, 3), panelCenter), false, 'Target inside the wall was incorrectly classified as occluded content')

  let camera
  function CameraProbe() { camera = useThree((state) => state.camera); return null }
  useRoomCanvasStore.getState().applyScan({ id: 'wall-test', room: { surfaces, colliders: [] }, furniture: [] })
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(ScannedRoom), React.createElement(CameraProbe)), { camera: { position: [0, 4, 6] } })
  const walls = () => renderer.scene.findAll((node) => node.instance.name === 'scan-wall')
  const solid = walls()[0].instance.material
  await renderer.advanceFrames(32, 1 / 60)
  assert.equal(walls()[0].instance.material.opacity, CUTAWAY_OPACITY)
  assert.equal(walls()[1].instance.material.opacity, 1)
  camera.position.set(0, 4, -6)
  await renderer.advanceFrames(32, 1 / 60)
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
    await renderer.advanceFrames(32, 1 / 60)
    const faded = walls().filter((wall) => wall.instance.material.opacity < 0.999).length
    assert.ok(faded > 0 && faded < walls().length, `Real scan has all or no walls faded from ${x},${z}: ${faded}/${walls().length}`)
    counts.push(`${x},${z}: ${faded} faded / ${walls().length - faded} solid`)
  }
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls().every((wall) => wall.instance.material.opacity === 1 && !wall.instance.material.transparent))
  // Actual component with the synthetic S boundary must show the same extra fade.
  await act(async () => useRoomCanvasStore.getState().applyScan({ id: 's-wall-test', room: { surfaces: sSurfaces, colliders: [] }, furniture: [] }))
  camera.position.copy(sCamera)
  await renderer.advanceFrames(32, 1 / 60)
  assert.equal(walls()[1].instance.material.opacity, CUTAWAY_OPACITY)
  assert.equal(walls()[3].instance.material.opacity, 1)
  console.log(`PASS: stable Edit render queue/depth/shader through fade endpoints, repeated 0.5s fades at 30/60/120fps, interruption, stationary camera, reduced motion, immediate Play opacity, S-boundary occlusion, material reuse; actual scan: ${counts.join('; ')}`)
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
