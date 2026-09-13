const SCOPE_WIDTH = 10

interface ConsoleFormatInput {
  data: unknown[]
  message?: { date?: Date; scope?: string }
}

const pad = (value: number): string => value.toString(10).padStart(2, '0')

/** Compact console prefix: aligned scope, no empty-scope gap. */
export function formatDesktopConsoleLog(input: ConsoleFormatInput): unknown[] {
  const date = input.message?.date ?? new Date()
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const scope = (input.message?.scope ?? '').trim().padEnd(SCOPE_WIDTH)
  const prefix = `${time} ${scope}`
  const data = input.data ?? []
  if (data.length === 0) {
    return [prefix.trimEnd()]
  }
  const [first, ...rest] = data
  if (typeof first === 'string') {
    return [`${prefix} ${first}`, ...rest]
  }
  return [prefix, ...data]
}
