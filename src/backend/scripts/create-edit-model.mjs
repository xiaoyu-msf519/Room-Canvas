import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { weld, simplify } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const document = await io.read(process.argv[2])
await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.12, error: 0.005 }),
)
for (const texture of document.getRoot().listTextures()) {
  const image = texture.getImage()
  if (!image) continue
  const encoded = await sharp(Buffer.from(image)).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  texture.setImage(encoded).setMimeType('image/webp')
}
document.createExtension(EXTTextureWebP).setRequired(true)
await io.write(process.argv[3], document)
