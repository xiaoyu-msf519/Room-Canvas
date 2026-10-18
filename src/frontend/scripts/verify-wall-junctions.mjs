import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const python = path.join(root, 'env/backend/Scripts/python.exe')
const scene = JSON.parse(execFileSync(python, ['-c', "import sys,json; sys.path.insert(0,'src/backend'); from app.example_layout import create_example_layout; print(json.dumps(create_example_layout('junction-fixture')))"], { cwd: root, encoding: 'utf8' }))
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { trimWallJunctions } = await vite.ssrLoadModule('/src/scene/wallJunctions.ts')
  const { Quaternion } = await import('three')
  const walls = scene.room.surfaces.filter((surface) => surface.kind === 'wall')
  const normalized = trimWallJunctions(scene.room.surfaces).filter((surface) => surface.kind === 'wall')
  assert.equal(normalized.length, walls.length)
  const bounds = (wall) => {
    const rotated = Math.abs(new Quaternion(...wall.rotation).y) > 0.5
    const width = rotated ? wall.size[2] : wall.size[0]
    const depth = rotated ? wall.size[0] : wall.size[2]
    return [[wall.position[0] - width / 2, wall.position[0] + width / 2], [wall.position[1] - wall.size[1] / 2, wall.position[1] + wall.size[1] / 2], [wall.position[2] - depth / 2, wall.position[2] + depth / 2]]
  }
  for (let i = 0; i < normalized.length; i++) for (let j = i + 1; j < normalized.length; j++) {
    const a = bounds(normalized[i]), b = bounds(normalized[j])
    assert.ok(![0, 1, 2].every((axis) => Math.min(a[axis][1], b[axis][1]) - Math.max(a[axis][0], b[axis][0]) > 1e-7), `Wall solids still overlap: ${normalized[i].id} / ${normalized[j].id}`)
  }
  const identity = [0, 0, 0, 1]
  const vertical = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
  const tWalls = trimWallJunctions([
    { id: 'through', kind: 'wall', position: [0, 1.4, 0], size: [4, 2.8, 0.14], rotation: identity },
    { id: 'terminating', kind: 'wall', position: [0, 1.4, -1], size: [2, 2.8, 0.14], rotation: vertical },
  ]).filter((surface) => surface.kind === 'wall')
  assert.ok(tWalls.find((surface) => surface.id === 'terminating').size[0] < 2, 'The terminating T wall was not trimmed')
  const corner = trimWallJunctions([
    { id: 'corner-h', kind: 'wall', position: [-1, 1.4, 0], size: [2, 2.8, 0.14], rotation: identity },
    { id: 'corner-v', kind: 'wall', position: [0, 1.4, 1], size: [2, 2.8, 0.14], rotation: vertical },
  ]).filter((surface) => surface.kind === 'wall')
  assert.equal(corner.find((surface) => surface.id === 'corner-h').size[0], 2, 'An L corner must not be shortened')
  assert.equal(corner.find((surface) => surface.id === 'corner-v').size[0], 2, 'An L corner must not be shortened')
  console.log(`PASS: normalized ${normalized.length} generated wall panels, no overlapping AABBs, T terminators trimmed while L corners remain intact.`)
} finally { await vite.close() }
