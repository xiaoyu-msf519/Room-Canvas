import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { create, act } from '@react-three/test-renderer'
import { createServer } from 'vite'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { Quaternion, ShaderLib, Vector3 } = createRequire(import.meta.url)('three')
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
let renderer
try {
  const { createRoomVolume, wallRayIntersectsRoom, createWallMaterials } = await vite.ssrLoadModule('/src/scene/wallVisibility.ts')
  const { ScannedRoom } = await vite.ssrLoadModule('/src/scene/ScannedRoom.tsx')
  const { useRoomCanvasStore } = await vite.ssrLoadModule('/src/state/useRoomCanvasStore.ts')
  const floorRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2).toArray()
  const floor = {
    id: 'floor', kind: 'floor', position: [0, 0, 0], rotation: floorRotation, size: [4, 4, 0.05],
    polygonCorners: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]],
  }
  const wall = { id: 'wall', kind: 'wall', position: [0, 1.5, 2], rotation: [0, 0, 0, 1], size: [4, 3, 0.1] }
  const volume = createRoomVolume([floor, wall])
  const cases = [
    ['near wall, interior beyond the wall', [0, 1.5, 6], [0, 1.5, 2], true],
    ['far wall, interior before the wall', [0, 1.5, 6], [0, 1.5, -2], true],
    ['camera inside the room', [0, 1.5, 0], [0, 1.5, 2], true],
    ['ray above the ceiling', [0, 5, 6], [0, 5, 2], false],
    ['ray below the floor', [0, -1, 6], [0, -1, 2], false],
    ['room only behind the camera', [0, 1.5, 6], [0, 1.5, 8], false],
    ['ray misses the room sideways', [6, 1.5, 6], [6, 1.5, 2], false],
    ['high camera looking down into the room', [0, 6, 6], [0, 1.5, 2], true],
    ['camera and wall point coincide', [0, 1.5, 2], [0, 1.5, 2], false],
  ]
  for (const [name, camera, point, expected] of cases) {
    assert.equal(wallRayIntersectsRoom(volume, new Vector3(...camera), new Vector3(...point), true), expected, name)
    assert.equal(wallRayIntersectsRoom(volume, new Vector3(...camera), new Vector3(...point), false), false, `Play must stay opaque: ${name}`)
  }

  const concave = { ...floor, polygonCorners: [[-2, 2, 0], [2, 2, 0], [2, 0, 0], [0, 0, 0], [0, -2, 0], [-2, -2, 0]] }
  const concaveVolume = createRoomVolume([concave, wall])
  assert.equal(wallRayIntersectsRoom(concaveVolume, new Vector3(1, 5, 1), new Vector3(1, -1, 1), true), false, 'Concave room notch incorrectly treated as interior')
  assert.equal(wallRayIntersectsRoom(concaveVolume, new Vector3(-1, 5, 1), new Vector3(-1, -1, 1), true), true)
  // Two points on the same large wall can produce different results.
  assert.equal(wallRayIntersectsRoom(volume, new Vector3(0, 1.5, 6), new Vector3(0, 1.5, 2), true), true)
  assert.equal(wallRayIntersectsRoom(volume, new Vector3(0, 1.5, 6), new Vector3(5, 1.5, 2), true), false)
  assert.equal(wallRayIntersectsRoom(createRoomVolume([]), new Vector3(0, 1, 6), new Vector3(0, 1, 2), true), false)

  const materials = createWallMaterials(volume)
  const shaders = [materials.solid, materials.overlay].map((material) => {
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} }
    material.onBeforeCompile(shader)
    assert.ok(shader.fragmentShader.includes('rcRayCrossesInterior'))
    assert.ok(shader.vertexShader.includes('rcWallWorldPosition = (modelMatrix'))
    assert.equal(shader.uniforms.rcEditCutaway, materials.edit)
    return shader
  })
  assert.ok(shaders[0].fragmentShader.includes('if (rcCutaway) discard'))
  assert.ok(shaders[1].fragmentShader.includes('if (!rcCutaway) discard'))
  assert.equal(materials.solid.depthWrite, true)
  assert.equal(materials.solid.transparent, false)
  assert.equal(materials.overlay.depthWrite, false)
  materials.edit.value = false
  assert.equal(shaders[0].uniforms.rcEditCutaway.value, false)
  assert.equal(shaders[1].uniforms.rcEditCutaway.value, false)
  materials.dispose()

  const scan = { id: 'wall-test', room: { surfaces: [floor, wall], colliders: [] }, furniture: [] }
  useRoomCanvasStore.getState().applyScan(scan)
  renderer = await create(React.createElement(ScannedRoom))
  assert.equal(renderer.scene.findAll((node) => node.instance.name === 'scan-wall-cutaway').length, 1)
  const solid = renderer.scene.findByProps({ name: 'scan-wall' }).instance.material
  let shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} }
  solid.onBeforeCompile(shader)
  assert.equal(shader.uniforms.rcEditCutaway.value, true)
  await act(async () => useRoomCanvasStore.getState().setMode('play'))
  assert.equal(shader.uniforms.rcEditCutaway.value, false)
  assert.equal(renderer.scene.findAll((node) => node.instance.name === 'scan-wall-cutaway').length, 0)
  assert.equal(solid.opacity, 1)
  await act(async () => useRoomCanvasStore.getState().setMode('edit'))
  assert.equal(shader.uniforms.rcEditCutaway.value, true)
  assert.equal(renderer.scene.findAll((node) => node.instance.name === 'scan-wall-cutaway').length, 1)
  // Background task polls with identical geometry must not allocate new materials.
  await act(async () => useRoomCanvasStore.getState().applyScan(structuredClone(scan)))
  assert.equal(renderer.scene.findByProps({ name: 'scan-wall' }).instance.material, solid)
  console.log('PASS: entire forward ray/room volume intersections, near and far walls, per-point classification, concave footprint, heights, behind-camera rejection, Edit/Play switching, depth writes, material reuse.')
} finally {
  if (renderer) await renderer.unmount()
  await vite.close()
}
