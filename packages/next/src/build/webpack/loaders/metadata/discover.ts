import type {
  CollectingMetadata,
  PossibleStaticMetadataFileNameConvention,
} from './types'
import path from 'path'
import { stringify } from 'querystring'
import { STATIC_METADATA_IMAGES } from '../../../../lib/metadata/is-metadata-route'
import { WEBPACK_RESOURCE_QUERIES } from '../../../../lib/constants'
import { MetadataResolver } from '../next-app-loader'

const METADATA_TYPE = 'metadata'

// Produce all compositions with filename (icon, apple-icon, etc.) with extensions (png, jpg, etc.)
async function enumMetadataFiles(
  dir: string,
  filename: string,
  extensions: readonly string[],
  {
    metadataResolver,
    // When set to true, possible filename without extension could: icon, icon0, ..., icon9
    numericSuffix,
  }: {
    metadataResolver: MetadataResolver
    numericSuffix: boolean
  }
): Promise<string[]> {
  const collectedFiles: string[] = []

  const possibleFileNames = [filename].concat(
    numericSuffix
      ? Array(10)
          .fill(0)
          .map((_, index) => filename + index)
      : []
  )
  for (const name of possibleFileNames) {
    const resolved = await metadataResolver(dir, name, extensions)
    if (resolved) {
      collectedFiles.push(resolved)
    }
  }

  return collectedFiles
}

export async function createStaticMetadataFromRoute(
  resolvedDir: string,
  {
    segment,
    metadataResolver,
    isRootLayoutOrRootPage,
    pageExtensions,
    basePath,
  }: {
    segment: string
    metadataResolver: MetadataResolver
    isRootLayoutOrRootPage: boolean
    pageExtensions: string[]
    basePath: string
  }
) {
  let hasStaticMetadataFiles = false
  const staticImagesMetadata: CollectingMetadata = {
    icon: [],
    apple: [],
    twitter: [],
    openGraph: [],
    manifest: undefined,
  }

  async function collectIconModuleIfExists(
    type: PossibleStaticMetadataFileNameConvention
  ) {
    if (type === 'manifest') {
      const staticManifestExtension = ['webmanifest', 'json']
      const manifestFile = await enumMetadataFiles(
        resolvedDir,
        'manifest',
        staticManifestExtension.concat(pageExtensions),
        { metadataResolver, numericSuffix: false }
      )
      if (manifestFile.length > 0) {
        hasStaticMetadataFiles = true
        const { name, ext } = path.parse(manifestFile[0])
        const extension = staticManifestExtension.includes(ext.slice(1))
          ? ext.slice(1)
          : 'webmanifest'
        staticImagesMetadata.manifest = JSON.stringify(`/${name}.${extension}`)
      }
      return
    }

    const resolvedMetadataFiles = await enumMetadataFiles(
      resolvedDir,
      STATIC_METADATA_IMAGES[type].filename,
      [
        ...STATIC_METADATA_IMAGES[type].extensions,
        ...(type === 'favicon' ? [] : pageExtensions),
      ],
      { metadataResolver, numericSuffix: true }
    )
    resolvedMetadataFiles
      .sort((a, b) => a.localeCompare(b))
      .forEach((filepath) => {
        const imageModuleImportSource = `next-metadata-image-loader?${stringify(
          {
            type,
            segment,
            basePath,
            pageExtensions,
          }
        )}!${filepath}?${WEBPACK_RESOURCE_QUERIES.metadata}`

        const imageModule = `(async (props) => (await import(/* webpackMode: "eager" */ ${JSON.stringify(
          imageModuleImportSource
        )})).default(props))`
        hasStaticMetadataFiles = true
        if (type === 'favicon') {
          staticImagesMetadata.icon.unshift(imageModule)
        } else {
          staticImagesMetadata[type].push(imageModule)
        }
      })
  }

  // Intentially make these serial to reuse directory access cache.
  await collectIconModuleIfExists('icon')
  await collectIconModuleIfExists('apple')
  await collectIconModuleIfExists('openGraph')
  await collectIconModuleIfExists('twitter')
  if (isRootLayoutOrRootPage) {
    await collectIconModuleIfExists('favicon')
    await collectIconModuleIfExists('manifest')
  }

  return hasStaticMetadataFiles ? staticImagesMetadata : null
}

export function createMetadataExportsCode(
  metadata: Awaited<ReturnType<typeof createStaticMetadataFromRoute>>
) {
  return metadata
    ? `${METADATA_TYPE}: {
    icon: [${metadata.icon.join(',')}],
    apple: [${metadata.apple.join(',')}],
    openGraph: [${metadata.openGraph.join(',')}],
    twitter: [${metadata.twitter.join(',')}],
    manifest: ${metadata.manifest ? metadata.manifest : 'undefined'}
  }`
    : ''
}
