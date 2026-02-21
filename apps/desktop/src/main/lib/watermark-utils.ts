import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scopedLoggers } from '../utils/logger'

const WATERMARK_TITLE_MAX = 28
const WATERMARK_AUTHOR_MAX = 60

const sanitizeWatermarkLine = (value: string): string => {
  return value
    .replace(/[\p{C}]/gu, '') // Control characters
    .replace(/\p{Extended_Pictographic}/gu, '') // Emoji/pictographs
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFD]/g, '') // Zero-width & invisible formatting
    .replace(/[\uFE00-\uFE0F]/g, '') // Variation selectors
}

export const normalizeWatermarkLine = (
  value: string | undefined,
  fallback: string,
  maxLength: number
) => {
  const cleaned = sanitizeWatermarkLine(value ?? '')
  const trimmed = cleaned.replace(/\s+/g, ' ').trim()
  const resolved = trimmed || fallback
  if (resolved.length <= maxLength) {
    return resolved
  }
  return `${resolved.slice(0, Math.max(0, maxLength - 3))}...`
}

export const buildShareWatermarkText = (title?: string, author?: string): string => {
  const titleLine = normalizeWatermarkLine(title, 'Untitled video', WATERMARK_TITLE_MAX)
  const authorLine = normalizeWatermarkLine(`by ${author}`, 'Unknown author', WATERMARK_AUTHOR_MAX)
  return [titleLine, authorLine, 'Downloaded with VidBee'].join(' ')
}

const containsCjk = (text: string): boolean =>
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(text)

const containsCyrillic = (text: string): boolean => /[\u0400-\u04ff]/.test(text)

const buildWatermarkFontCandidates = (text: string): string[] => {
  const platform = process.platform
  const base: string[] = []
  const cjk: string[] = []
  const cyrillic: string[] = []

  if (platform === 'darwin') {
    base.push(
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Helvetica.ttc',
      '/System/Library/Fonts/Supplemental/Helvetica.ttf'
    )
    cjk.push(
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
      '/System/Library/Fonts/Hiragino Sans GB.ttc',
      '/System/Library/Fonts/Supplemental/Hiragino Sans GB.ttc',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/STHeiti Medium.ttc',
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Supplemental/PingFang.ttc',
      '/System/Library/Fonts/PingFangSC.ttc',
      '/System/Library/Fonts/PingFangTC.ttc',
      '/System/Library/Fonts/AppleSDGothicNeo.ttc'
    )
    cyrillic.push(
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
    )
  } else if (platform === 'win32') {
    base.push(
      'C:\\Windows\\Fonts\\segoeui.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\tahoma.ttf'
    )
    cjk.push(
      'C:\\Windows\\Fonts\\msyh.ttc',
      'C:\\Windows\\Fonts\\msyh.ttf',
      'C:\\Windows\\Fonts\\msyhbd.ttc',
      'C:\\Windows\\Fonts\\simhei.ttf',
      'C:\\Windows\\Fonts\\simsun.ttc',
      'C:\\Windows\\Fonts\\meiryo.ttc',
      'C:\\Windows\\Fonts\\yugothr.ttc',
      'C:\\Windows\\Fonts\\malgun.ttf'
    )
    cyrillic.push('C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf')
  } else {
    base.push(
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
    )
    cjk.push(
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansTC-Regular.ttf',
      '/usr/share/fonts/truetype/arphic/uming.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
    )
    cyrillic.push('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
  }

  const preferred = containsCjk(text) ? cjk : containsCyrillic(text) ? cyrillic : []
  const seen = new Set<string>()
  const ordered = [...preferred, ...base]
  return ordered.filter((candidate) => {
    if (seen.has(candidate)) {
      return false
    }
    seen.add(candidate)
    return true
  })
}

const resolveWatermarkFontFile = (text: string): string | null => {
  const candidates = buildWatermarkFontCandidates(text)
  scopedLoggers.download.info(`Searching for fonts. Candidates: ${candidates.length}`)

  for (const candidate of candidates) {
    scopedLoggers.download.info(`Checking font: ${candidate}`)
    if (fs.existsSync(candidate)) {
      scopedLoggers.download.info(`✓ Using font: ${candidate}`)
      return candidate
    }
    scopedLoggers.download.info(`✗ Font not found: ${candidate}`)
  }

  scopedLoggers.download.warn(
    `No suitable font found for text containing CJK/Cyrillic characters. Tried ${candidates.length} candidates. Text rendering may be incomplete.`
  )
  return null
}

const escapeFilterValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

const buildDrawTextFilter = (textFilePath: string, fontFile?: string): string => {
  const fontSize = 'max(14\\, min(44\\, h*0.024))'
  const edgePadding = 'max(8\\, h*0.018)'
  const options = [
    `textfile=${escapeFilterValue(textFilePath)}`,
    fontFile ? `fontfile=${escapeFilterValue(fontFile)}` : null,
    'fontcolor=white',
    'text_align=right',
    'shadowcolor=black@0.7',
    'shadowx=1',
    'shadowy=1',
    `fontsize=${fontSize}`,
    `x=w-tw-${edgePadding}`,
    `y=h-th-${edgePadding}`
  ].filter(Boolean)
  return `drawtext=${options.join(':')}`
}

const resolveWatermarkOutputPaths = (inputPath: string) => {
  const dir = path.dirname(inputPath)
  const ext = path.extname(inputPath).slice(1).toLowerCase()
  const base = path.basename(inputPath, path.extname(inputPath))
  const outputExt = ['mp4', 'm4v', 'mov', 'mkv'].includes(ext) ? ext : 'mp4'
  const outputPath = path.join(dir, `${base}.${outputExt}`)
  const tempOutputPath = path.join(dir, `${base}.vidbee-watermark.${Date.now()}.${outputExt}`)
  return { outputPath, tempOutputPath, outputExt }
}

const runFfmpeg = async (ffmpegPath: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''

    process.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    process.on('error', (error) => {
      reject(error)
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}: ${stderr.trim()}`))
    })
  })
}

const replaceOutputFile = async (outputPath: string, tempPath: string): Promise<void> => {
  let backupPath: string | null = null
  if (fs.existsSync(outputPath)) {
    backupPath = `${outputPath}.vidbee-backup-${Date.now()}`
    await fs.promises.rename(outputPath, backupPath)
  }

  try {
    await fs.promises.rename(tempPath, outputPath)
    if (backupPath) {
      await fs.promises.unlink(backupPath).catch(() => {})
    }
  } catch (error) {
    if (backupPath) {
      await fs.promises.rename(backupPath, outputPath).catch(() => {})
    }
    throw error
  }
}

export const applyShareWatermark = async (params: {
  inputPath: string
  ffmpegPath: string
  title?: string
  author?: string
}): Promise<{ outputPath: string; fileSize: number } | null> => {
  const { inputPath, ffmpegPath, title, author } = params
  if (!inputPath) {
    return null
  }

  const { outputPath, tempOutputPath, outputExt } = resolveWatermarkOutputPaths(inputPath)
  const textFilePath = path.join(
    os.tmpdir(),
    `vidbee-watermark-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  )
  const watermarkText = buildShareWatermarkText(title, author)
  let outputReady = false

  try {
    await fs.promises.writeFile(textFilePath, watermarkText, 'utf8')
    const fontFile = resolveWatermarkFontFile(watermarkText)
    const filter = buildDrawTextFilter(textFilePath, fontFile ?? undefined)
    const args = [
      '-y',
      '-hide_banner',
      '-i',
      inputPath,
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '192k'
    ]

    if (['mp4', 'm4v', 'mov'].includes(outputExt)) {
      args.push('-movflags', '+faststart')
    }

    args.push(tempOutputPath)
    await runFfmpeg(ffmpegPath, args)
    await replaceOutputFile(outputPath, tempOutputPath)
    outputReady = true

    if (outputPath !== inputPath) {
      await fs.promises.unlink(inputPath).catch(() => {})
    }

    const stats = await fs.promises.stat(outputPath)
    return { outputPath, fileSize: stats.size }
  } catch (error) {
    scopedLoggers.download.error('Failed to apply watermark:', error)
    throw error
  } finally {
    await fs.promises.unlink(textFilePath).catch(() => {})
    if (!outputReady) {
      await fs.promises.unlink(tempOutputPath).catch(() => {})
    }
  }
}
