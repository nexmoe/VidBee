/** Scope synchronous extension initialization to the application's Pi directory. */
export function inAgentDirectory<T>(directory: string, read: () => T): T {
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = directory
  try {
    return read()
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR
    } else {
      process.env.PI_CODING_AGENT_DIR = previous
    }
  }
}
