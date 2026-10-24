export interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

/** Format a cue timestamp as HH:MM:SS,mmm for SubRip and video exports. */
export function formatSrtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/** Build a SubRip document shared by interactive and MCP exports. */
export function buildSrtDocument(units: SubtitleCue[]): string {
  return units
    .map(
      (unit, index) =>
        `${index + 1}\n${formatSrtClock(unit.startMs)} --> ${formatSrtClock(unit.endMs)}\n${unit.text}`
    )
    .join('\n\n')
}

/** Build a WebVTT document shared by transcript exports and subtitle-only downloads. */
export function buildVttDocument(units: SubtitleCue[]): string {
  return `WEBVTT\n\n${units
    .map(
      (unit) =>
        `${formatSrtClock(unit.startMs).replace(',', '.')} --> ${formatSrtClock(unit.endMs).replace(',', '.')}\n${unit.text}`
    )
    .join('\n\n')}`
}

/** Format an ASS timestamp using centisecond precision. */
export function formatAssClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/** Escape captions so libass cannot interpret user text as formatting commands. */
export function escapeAssText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll(/\r?\n/g, '\\N')
}

/** Build the same ASS track for interactive and externally requested caption burn-in. */
export function buildAssDocument(units: SubtitleCue[]): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,80,80,64,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const events = units.map(
    (unit) =>
      `Dialogue: 0,${formatAssClock(unit.startMs)},${formatAssClock(Math.max(unit.endMs, unit.startMs + 400))},Default,,0,0,0,,${escapeAssText(unit.text)}`
  )
  return [...header, ...events].join('\n')
}
