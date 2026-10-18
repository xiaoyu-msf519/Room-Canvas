import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { create, act } from '@react-three/test-renderer'
import { useThree } from '@react-three/fiber'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { BoxGeometry, Mesh, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { createWallFacing, createWallOccluder, createWallVisuals, isInsideFloor, wallOpacityAt, CUTAWAY_OPACITY, WALL_FADE_SECONDS } = await vite.ssrLoadModule('/src/scene/wallVisibility.ts')
  const { createWalkFloor } = await vite.ssrLoadModule('/src/scene/navigation.ts')
  const { createWallTransparency } = await vite.ssrLoadModule('/src/scene/wallTransparency.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')

  function verifyFaceOrder(surfaces, positions) {
    const visuals = createWallVisuals(surfaces)
    const transparency = createWallTransparency(visuals.walls)
    const sourceMeshes = visuals.walls.filter(({ surface }) => surface.size.every((size) => size >= 0.00001)).map(({ surface, material }) => {
      const mesh = new Mesh(new BoxGeometry(...surface.size), material)
      mesh.userData.wallId = surface.id
      mesh.position.fromArray(surface.position)
      mesh.quaternion.fromArray(surface.rotation)
      mesh.updateMatrixWorld(true)
      return mesh
    })
    transparency.meshes.forEach((mesh) => mesh.updateMatrixWorld(true))
    const camera = new PerspectiveCamera(52, 1.5, 0.05, 100)
    const raycaster = new Raycaster()
    let checked = 0
    try {
      for (const position of positions) {
        camera.position.fromArray(position)
        camera.lookAt(0, Math.min(position[1], 0.8), 0)
        camera.updateMatrixWorld(true)
        transparency.update(camera.position)
        for (let x = -0.95; x < 1; x += 0.1) {
          for (let y = -0.9; y < 1; y += 0.15) {
            raycaster.setFromCamera(new Vector2(x, y), camera)
            const hits = raycaster.intersectObjects(transparency.meshes, false)
            const source = raycaster.intersectObjects(sourceMeshes, false)
            assert.equal(Boolean(hits.length), Boolean(source.length), `BSP geometry mismatch at ${position}, pixel ${x},${y}: source ${source[0]?.object.userData.wallId}, split ${hits[0]?.object.userData.wallId}, ${transparency.meshes.length} face groups`)
            if (hits.length) assert.ok(Math.abs(hits[0].distance - source[0].distance) < 0.001, 'BSP splitting displaced the wall surface')
            for (let near = 0; near < hits.length; near++) {
              for (let far = near + 1; far < hits.length; far++) {
                if (hits[far].distance - hits[near].distance < 0.001) continue
                assert.ok(hits[far].object.renderOrder < hits[near].object.renderOrder, `Wall fragments render in front of nearer faces from ${position}`)
                checked++
              }
            }
          }
        }
      }
      assert.ok(checked > 0, 'Face-order regression did not cover overlapping wall layers')
      return `${transparency.meshes.length} face groups / ${checked} depth-order comparisons`
    } finally {
      sourceMeshes.forEach((mesh) => mesh.geometry.dispose())
      transparency.dispose()
      visuals.dispose()
    }
  }
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
  assert.equal(fadingNorth.alphaHash, false, 'Edit walls must use smooth opacity without dithering')
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
  assert.equal(fadingNorth.depthWrite, false, 'Smooth fades must not hide geometry behind them by writing depth')
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
  assert.equal(fadingNorth.transparent, true, 'Fade endpoint changed Edit wall blending')
  assert.equal(fadingNorth.depthWrite, false, 'Fade endpoint changed Edit wall depth writes')
  visuals.update(northCamera, true)
  visuals.advance(0.1)
  visuals.update(northCamera, false)
  assert.ok(visuals.walls.every((wall) => wall.material.opacity === 1 && wall.material.depthWrite && !wall.material.alphaHash), 'Play did not cancel an unfinished fade immediately')
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
        assert.equal(material.transparent, true, `Edit wall blending changed at ${fps}fps, frame ${frame}`)
        assert.equal(material.depthWrite, false, `Edit wall started writing depth at ${fps}fps, frame ${frame}`)
        assert.equal(material.alphaHash, false, `Edit wall acquired dithering at ${fps}fps, frame ${frame}`)
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
    [[0, 0.25, 6], ['north']], [[0, 1.65, -6], ['south']],
    [[6, 0.25, 0], ['east']], [[-6, 1.65, 0], ['west']],
    [[6, 0.25, 6], ['north', 'east']], [[0, 0.25, 0], []],
  ]) {
    visuals.update(new Vector3(...position), true)
    visuals.advance(WALL_FADE_SECONDS)
    const faded = visuals.walls.filter((wall) => wall.material.opacity < 1).map((wall) => wall.surface.id)
    assert.deepEqual(faded.sort(), [...fadedIds].sort(), `Wrong wall cutaway from ${position}`)
    for (const wall of visuals.walls) {
      assert.equal(wall.material.transparent, true)
      assert.equal(wall.material.depthWrite, false)
      assert.equal(wall.material.alphaHash, false)
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
  for (const height of [5, 1.65, 0.25]) {
    sVisuals.update(new Vector3(sCamera.x, height, sCamera.z), true)
    sVisuals.advance(WALL_FADE_SECONDS)
    for (const wall of sVisuals.walls.slice(0, 3)) assert.equal(wall.material.opacity, CUTAWAY_OPACITY, `${wall.surface.id} remains opaque across the L-room corner at height ${height}`)
    assert.equal(sVisuals.walls[3].material.opacity, 1, `L-room rear boundary became transparent at height ${height}`)
  }
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
  const materialsOf = (wall) => Array.isArray(wall.instance.material) ? wall.instance.material : [wall.instance.material]
  const materialOf = (wall) => materialsOf(wall)[0]
  const fragments = () => renderer.scene.findAll((node) => node.instance.name === 'scan-wall-fragment')
  const fragmentGroup = () => renderer.scene.findByProps({ name: 'edit-wall-fragments' }).instance
  const solid = materialOf(walls()[0])
  const firstFragment = fragments()[0].instance
  assert.ok(walls().every((wall) => !wall.instance.visible), 'Edit draws both source boxes and BSP faces')
  assert.equal(fragmentGroup().visible, true)
  assert.ok(fragments().every((fragment) => walls().some((wall) => materialsOf(wall).includes(fragment.instance.material))), 'Wall fragments do not share the animated wall materials')
  await renderer.advanceFrames(32, 1 / 60)
  assert.equal(materialOf(walls()[0]).opacity, CUTAWAY_OPACITY)
  assert.equal(materialOf(walls()[1]).opacity, 1)
  camera.position.set(0, 4, -6)
  await renderer.advanceFrames(32, 1 / 60)
  assert.equal(materialOf(walls()[0]).opacity, 1, 'Near/far walls did not swap after orbit')
  assert.equal(materialOf(walls()[1]).opacity, CUTAWAY_OPACITY)
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls().every((wall) => materialsOf(wall).every((material) => material.opacity === 1 && material.depthWrite)))
  assert.ok(walls().every((wall) => wall.instance.visible), 'Play source wall meshes are hidden')
  assert.equal(fragmentGroup().visible, false, 'Play also renders the Edit face fragments')
  await act(async () => useRoomCanvasStore.getState().setMode('edit'))
  await act(async () => useRoomCanvasStore.getState().applyScan({ id: 'wall-test', room: { surfaces: structuredClone(surfaces), colliders: [] }, furniture: [] }))
  assert.equal(materialOf(walls()[0]), solid, 'Task polling reallocated wall materials')
  assert.equal(fragments()[0].instance, firstFragment, 'Task polling rebuilt the wall BSP')
  await renderer.unmount()
  renderer = null

  // Run the same camera updates against the real 30-panel scan, not only a cube.
  const actual = await fetch('http://127.0.0.1:8000/api/scenes/latest').then((response) => response.json())
  const positions = [[8, 8], [-8, 8], [-8, -8], [8, -8]].flatMap(([x, z]) => [7, 1.5, 0.25].map((height) => [x, height, z]))
  const bspStats = verifyFaceOrder(actual.room.surfaces, positions)
  verifyFaceOrder(sSurfaces, [[-6, 5, 6], [-6, 1.5, 6], [-6, 0.25, 6]])
  useRoomCanvasStore.getState().applyScan(actual)
  renderer = await create(React.createElement(React.Fragment, null, React.createElement(ScannedRoom), React.createElement(CameraProbe)), { camera: { position: [8, 7, 8] } })
  const counts = []
  for (const [x, z] of [[8, 8], [-8, 8], [-8, -8], [8, -8]]) {
    for (const height of [7, 1.65, 0.25]) {
      const before = walls().map((wall) => materialOf(wall).opacity)
      const versions = walls().map((wall) => materialOf(wall).version)
      camera.position.set(x, height, z)
      camera.lookAt(0, Math.min(height, 0.8), 0)
      await renderer.advanceFrames(1, 1 / 60)
      walls().forEach((wall, index) => {
        const material = materialOf(wall)
        assert.equal(material.transparent, true, 'Changing elevation disabled smooth blending')
        assert.equal(material.alphaHash, false)
        assert.equal(material.depthWrite, false)
        assert.equal(material.version, versions[index], 'Changing elevation invalidated a wall shader')
        assert.ok(Math.abs(material.opacity - before[index]) < 0.1, 'Changing elevation bypassed the fade')
        assert.ok(materialsOf(wall).every((face) => face.opacity === material.opacity && face.transparent === material.transparent), 'Room-facing materials faded out of sync')
      })
      await renderer.advanceFrames(31, 1 / 60)
      const faded = walls().filter((wall) => materialOf(wall).opacity < 0.999).length
      assert.ok(faded > 0 && faded < walls().length, `Real scan has all or no walls faded from ${x},${height},${z}: ${faded}/${walls().length}`)
      counts.push(`${x},${height},${z}: ${faded} faded / ${walls().length - faded} solid`)
    }
  }
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.ok(walls().every((wall) => materialsOf(wall).every((material) => material.opacity === 1 && !material.transparent)))
  // Actual component with the synthetic S boundary must show the same extra fade.
  await act(async () => useRoomCanvasStore.getState().applyScan({ id: 's-wall-test', room: { surfaces: sSurfaces, colliders: [] }, furniture: [] }))
  camera.position.copy(sCamera)
  await renderer.advanceFrames(32, 1 / 60)
  assert.equal(materialOf(walls()[1]).opacity, CUTAWAY_OPACITY)
  assert.equal(materialOf(walls()[3]).opacity, 1)
  console.log(`PASS: smooth opacity without dithering; BSP ${bspStats}; stable Edit pipeline through repeated 0.5s fades at 30/60/120fps, interruption, reduced motion, immediate Play opacity, S-boundary occlusion, material reuse; actual scan: ${counts.join('; ')}`)
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
