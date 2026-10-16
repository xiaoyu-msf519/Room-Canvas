import assert from 'node:assert/strict'
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { TransformControls } from 'three-stdlib'
import { groundRotation } from '../src/scene/furnitureTransform.ts'

const up = new Vector3(0, 1, 0)
const scene = new Scene()
const furniture = new Group()
const size = new Vector3(2.1, 0.85, 0.9)
furniture.position.set(1.4, size.y / 2, -0.7)
furniture.add(new Mesh(new BoxGeometry(...size), new MeshBasicMaterial()))
scene.add(furniture)
const position = furniture.position.clone()
const camera = new PerspectiveCamera(52, 1.6, 0.05, 100)
const controls = new TransformControls(camera)
controls.setMode('rotate')
controls.setSpace('world')
controls.setSize(0.7)
controls.showX = false
controls.showY = true
controls.showZ = false
controls.attach(furniture)
scene.add(controls)
let released = 0

controls.addEventListener('objectChange', () => {
  furniture.quaternion.copy(groundRotation(furniture.quaternion))
})
controls.addEventListener('mouseUp', () => {
  // Simulate the persisted rotation being restored, including quaternion sign changes.
  const saved = groundRotation(furniture.quaternion).toArray()
  furniture.quaternion.fromArray(saved)
  released++
})

function assertGrounded() {
  assert.ok(new Vector3(0, 1, 0).applyQuaternion(furniture.quaternion).distanceTo(up) < 1e-10, 'Furniture tilted')
  assert.ok(furniture.position.distanceTo(position) < 1e-10, 'Rotation changed the furniture center')
  assert.ok(furniture.scale.distanceTo(new Vector3(1, 1, 1)) < 1e-10, 'Rotation changed the furniture size')
}

let drags = 0
for (const offset of [[5, 4, 6], [-5, 3, 6], [-4, 6, -6], [5, 5, -4]]) {
  camera.position.copy(position).add(new Vector3(...offset))
  camera.lookAt(position)
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)

  const visibleHandles = controls.gizmo.gizmo.rotate.children.filter((handle) => handle.visible)
  assert.ok(visibleHandles.length > 0, 'Rotation ring is not visible')
  assert.ok(visibleHandles.every((handle) => handle.name === 'Y'), 'Unexpected free or tilted rotation ring')

  for (let drag = 0; drag < 6; drag++) {
    scene.updateMatrixWorld(true)
    const radius = controls.gizmo.picker.rotate.children.find((handle) => handle.name === 'Y').scale.x
    let start
    // Find a real ray hit on the visible Y ring from this camera angle.
    for (let sample = 0; sample < 48; sample++) {
      const angle = sample / 48 * Math.PI * 2
      const point = position.clone().add(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      const ndc = point.project(camera)
      controls.pointerHover({ x: ndc.x, y: ndc.y, button: -1 })
      if (controls.axis === 'Y') { start = ndc; break }
    }
    assert.ok(start, 'Could not pick the Y rotation ring')
    const before = furniture.quaternion.clone()
    controls.pointerDown({ x: start.x, y: start.y, button: 0 })
    assert.equal(controls.dragging, true)
    for (let step = 1; step <= 20; step++) {
      controls.pointerMove({ x: start.x + step * 0.002, y: start.y + step * 0.001, button: -1 })
      scene.updateMatrixWorld(true)
      assertGrounded()
    }
    assert.ok(furniture.quaternion.angleTo(before) > 0.001, 'Dragging the ring did not rotate the furniture')
    const atRelease = furniture.quaternion.clone()
    controls.pointerUp({ x: start.x + 0.04, y: start.y + 0.02, button: 0 })
    controls.detach().attach(furniture)
    scene.updateMatrixWorld(true)
    assert.ok(furniture.quaternion.angleTo(atRelease) < 1e-7, 'Furniture jumped on release')
    assertGrounded()
    drags++
  }
}

// Heading stays continuous across +/- pi and multiple revolutions.
let previous
for (let step = 0; step <= 1440; step++) {
  const yaw = step * Math.PI / 180 - Math.PI * 4
  const rotation = groundRotation(new Quaternion().setFromAxisAngle(up, yaw))
  assert.ok(rotation.angleTo(new Quaternion().setFromAxisAngle(up, yaw)) < 1e-7)
  if (previous) assert.ok(rotation.angleTo(previous) < 0.018, 'Heading jumped at an angle boundary')
  previous = rotation
}
const tilted = new Quaternion().setFromEuler(new Euler(0.3, 1.2, -0.2, 'YXZ'))
assert.ok(up.clone().applyQuaternion(groundRotation(tilted)).distanceTo(up) < 1e-10)
assert.equal(released, drags)
controls.dispose()
console.log(`PASS: ${drags} real ring drags across 4 camera angles; stable release, center, height, size, and 4 full rotations.`)
