import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterFormatsByType as filterDesktopFormats,
  getDisplayFormats as getDesktopDisplayFormats
} from '../../../apps/desktop/src/renderer/src/components/download/format-presentation'
import { filterFormatsByType, getDisplayFormats } from '../src/format-presentation'
import type { VideoFormat } from '../src/types'

const video = (overrides: Partial<VideoFormat>): VideoFormat => ({
  formatId: 'video',
  ext: 'mp4',
  height: 1080,
  width: 1920,
  fps: 30,
  vcodec: 'avc1.640028',
  acodec: 'none',
  videoExt: 'mp4',
  protocol: 'https',
  ...overrides
})

test('360p HTTPS does not hide 1080p HLS in the picker', () => {
  const formats = [
    video({ formatId: 'low-http', height: 360, width: 640 }),
    video({ formatId: 'high-hls', protocol: 'm3u8_native' })
  ]
  const matching = filterFormatsByType(formats, 'video')
  const shown = getDisplayFormats({ formats: matching, type: 'video' }).videoFormats
  assert.deepEqual(
    shown.map((format) => format.formatId),
    ['high-hls', 'low-http']
  )
})

test('HTTPS is preferred only within equivalent video renditions', () => {
  const formats = [
    video({ formatId: 'hls', protocol: 'm3u8_native', filesizeApprox: 100_000_000 }),
    video({ formatId: 'http' }),
    video({ formatId: 'hls-60', protocol: 'm3u8', fps: 60 }),
    video({ formatId: 'hls-av1', protocol: 'm3u8', vcodec: 'av01.0.08M.08' }),
    video({ formatId: 'hls-hdr', protocol: 'm3u8', formatNote: '1080p HDR' }),
    video({ formatId: 'hls-muxed', protocol: 'm3u8', acodec: 'mp4a.40.2' })
  ]
  const shown = getDisplayFormats({ formats, type: 'video' }).videoFormats
  assert.deepEqual(
    new Set(shown.map((format) => format.formatId)),
    new Set(['http', 'hls-60', 'hls-av1', 'hls-hdr', 'hls-muxed'])
  )
  assert.equal(formats[0].formatId, 'hls')
})

test('distinct HLS audio languages and bitrates remain selectable', () => {
  const audio = (overrides: Partial<VideoFormat>): VideoFormat => ({
    ...video({ vcodec: 'none', videoExt: 'none', acodec: 'mp4a.40.2' }),
    tbr: 128,
    language: 'en',
    ...overrides
  })
  const formats = [
    audio({ formatId: 'en-http' }),
    audio({ formatId: 'ja-hls', language: 'ja', protocol: 'm3u8_native' }),
    audio({ formatId: 'en-high', tbr: 256, protocol: 'm3u8' })
  ]
  const matching = filterFormatsByType(formats, 'audio')
  const shown = getDisplayFormats({ formats: matching, type: 'audio', codec: 'auto' }).audioFormats
  assert.deepEqual(
    new Set(shown.map((format) => format.formatId)),
    new Set(['en-http', 'ja-hls', 'en-high'])
  )
})

test('HLS-only streams and empty results remain valid', () => {
  const hls = video({ protocol: 'm3u8_native' })
  assert.deepEqual(filterFormatsByType([hls], 'video'), [hls])
  assert.deepEqual(filterFormatsByType([], 'video'), [])
})

test('higher-bitrate HLS remains available at the same resolution and codec', () => {
  const formats = [
    video({ formatId: 'http', tbr: 1500 }),
    video({ formatId: 'hls', tbr: 4500, protocol: 'm3u8_native' })
  ]
  const shown = getDisplayFormats({ formats, type: 'video' }).videoFormats
  assert.deepEqual(new Set(shown.map((format) => format.formatId)), new Set(['http', 'hls']))
})

test('desktop metadata adapts to the same selection rules as the web picker', () => {
  const formats = [
    video({ formatId: 'low-http', height: 360, width: 640 }),
    video({ formatId: 'high-hls', protocol: 'm3u8_native' }),
    video({ formatId: 'hdr-hls', protocol: 'm3u8_native', formatNote: 'HDR' })
  ]
  const desktopFormats = formats.map((format) => ({
    ...format,
    format_id: format.formatId,
    format_note: format.formatNote,
    video_ext: format.videoExt
  }))
  const desktop = getDesktopDisplayFormats({
    formats: filterDesktopFormats(desktopFormats, 'video'),
    type: 'video'
  }).videoFormats
  const web = getDisplayFormats({
    formats: filterFormatsByType(formats, 'video'),
    type: 'video'
  }).videoFormats
  assert.deepEqual(
    desktop.map((format) => format.format_id),
    web.map((format) => format.formatId)
  )
})
