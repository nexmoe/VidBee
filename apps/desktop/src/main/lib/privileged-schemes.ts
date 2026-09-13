import { protocol } from 'electron'

/** HTTPS renderer pages treat these custom-protocol origins as mixed content unless Chromium trusts them. */
export const TRUSTWORTHY_CUSTOM_ORIGINS = ['vidbee://thumbnails'] as const

type PrivilegedScheme = Parameters<typeof protocol.registerSchemesAsPrivileged>[0][number]
type RegisterPrivilegedSchemes = (schemes: PrivilegedScheme[]) => void

/** Merge later privileged-scheme registrations onto earlier ones by scheme name. */
export function mergePrivilegedSchemes(
  existing: PrivilegedScheme[],
  incoming: readonly PrivilegedScheme[]
): PrivilegedScheme[] {
  const next = existing.map((item) => ({
    privileges: { ...item.privileges },
    scheme: item.scheme
  }))
  for (const scheme of incoming) {
    const current = next.find((item) => item.scheme === scheme.scheme)
    if (current) {
      current.privileges = { ...current.privileges, ...scheme.privileges }
      continue
    }
    next.push({
      privileges: { ...scheme.privileges },
      scheme: scheme.scheme
    })
  }
  return next
}

/** Collect privileged scheme registrations and flush them in one Electron call. */
export function createPrivilegedSchemeCollector(register: RegisterPrivilegedSchemes): {
  collect: RegisterPrivilegedSchemes
  flush: () => void
} {
  let collected: PrivilegedScheme[] = []
  return {
    collect(schemes) {
      collected = mergePrivilegedSchemes(collected, schemes)
    },
    flush() {
      register(collected)
    }
  }
}

/**
 * Collect every `registerSchemesAsPrivileged` call until flush.
 *
 * Electron keeps `--secure-schemes` from the last call. Better Auth registers
 * `user-image` after Desktop registers `vidbee`, which drops thumbnails from
 * the secure list and floods HTTPS renderer loads with mixed-content warnings.
 */
export function installPrivilegedSchemeCollector(): () => void {
  const original = protocol.registerSchemesAsPrivileged.bind(protocol)
  const collector = createPrivilegedSchemeCollector(original)
  protocol.registerSchemesAsPrivileged = collector.collect
  return () => {
    collector.flush()
    protocol.registerSchemesAsPrivileged = original
  }
}
