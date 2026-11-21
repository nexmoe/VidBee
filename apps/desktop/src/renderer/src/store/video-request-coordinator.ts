import {
  createMetadataRequestCoordinator,
  type MetadataRequestCoordinator
} from '@vidbee/ui/lib/download-metadata'

export type VideoInfoRequestCoordinator = MetadataRequestCoordinator

/** Preserve the single-video store's request API for #354 and #379. */
export const createVideoInfoRequestCoordinator = (): VideoInfoRequestCoordinator =>
  createMetadataRequestCoordinator()
