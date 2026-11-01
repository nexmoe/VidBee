import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  FEEDBACK_EMAIL,
  FEEDBACK_GITHUB_URL,
  FEEDBACK_REPORT_FILENAME
} from '@vidbee/ui/lib/feedback-diagnostics'
import type { Database } from 'better-sqlite3'
import { isAiPromptPresetName } from '../../shared/ai-prompts'
import type { AiPrompt } from '../../shared/ai-types'
import { BUILTIN_SKILLS } from '../../shared/builtin-skills'
import { parseAgentSkill } from './agent-skill-document'
import type { AgentSkillFiles } from './agent-skill-files'

export type LegacySkill = Omit<AiPrompt, 'name'> & {
  name?: string
  id?: string
  title?: string
  enabled?: unknown
  scope?: unknown
}

const UUID_NAME = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const LEGACY_DESCRIPTION = /^Use when the user requests ([\s\S]+)\.$/
const LEGACY_WORKFLOWS: Record<string, string> = {
  改为文章: 'rewrite-article',
  总结: 'summary',
  思维导图: 'mindmap'
}

/** Convert old free-form titles to portable names; reserve UUIDs exclusively for reading old records. */
function legacyName(skill: LegacySkill): string {
  if (skill.name && (!skill.id || skill.name !== skill.id)) {
    return skill.name
  }
  const previous = skill.name || skill.id
  if (previous && !UUID_NAME.test(previous)) {
    return previous
  }
  const title =
    skill.title?.trim() || skill.description?.match(LEGACY_DESCRIPTION)?.[1]?.trim() || ''
  return (
    LEGACY_WORKFLOWS[title] ||
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .replace(/-$/g, '') ||
    'skill'
  )
}

/** Remove the separate ID and safely move legacy documents and resources to their canonical names. */
export function migrateStoredSkills(
  records: readonly LegacySkill[],
  files: AgentSkillFiles
): {
  skills: AiPrompt[]
  renamed: Map<string, string>
} {
  const reserved = new Set([
    ...BUILTIN_SKILLS.map((skill) => skill.name),
    ...records
      .map((skill) => skill.name || skill.id)
      .filter((name): name is string => Boolean(name && !UUID_NAME.test(name)))
  ])
  const renamed = new Map<string, string>()
  const skills = records.map((record): AiPrompt => {
    const previous = record.name || record.id
    const base = legacyName(record)
    let name = base
    if (previous !== name) {
      let suffix = 1
      while (
        reserved.has(name) ||
        (existsSync(files.directory(name)) && previous && existsSync(files.directory(previous)))
      ) {
        name = `${base}-${++suffix}`
      }
    }
    reserved.add(name)
    const { id, title, enabled: _enabled, scope: _scope, ...saved } = record
    let migrated: AiPrompt = {
      ...saved,
      name,
      description: record.description || `Use when the user requests ${title?.trim() || name}.`
    }
    if (previous && previous !== name && existsSync(files.directory(previous))) {
      let document: ReturnType<typeof parseAgentSkill> | undefined
      try {
        document = parseAgentSkill(files.read(previous))
      } catch {
        // Keep malformed documents intact so the normal library error remains visible.
      }
      if (document) {
        migrated = { ...migrated, description: document.description, content: document.body }
        files.write(migrated, previous, document.frontmatter)
      } else {
        renameSync(files.directory(previous), files.directory(name))
      }
    } else if (
      !(files.isBuiltin(name) || record.name || existsSync(join(files.directory(name), 'SKILL.md')))
    ) {
      files.write(migrated)
    }
    if (id && id !== name) {
      renamed.set(id, name)
    }
    if (previous && previous !== name) {
      renamed.set(previous, name)
    }
    return migrated
  })
  return { skills, renamed }
}

/** Identify the two retired official translate bodies without treating local edits as upstream content. */
const RETIRED_TRANSLATE_DIGESTS = new Set([
  'ddb27d9035d3f786f43daabe40a2b750faa85d811df3508f81715b5dff04d37f',
  '351581f3acbe096d9abeb47e1cf93527c00dee352144ecf50b0088200894563f'
])

/** Descriptions authored by older official seeds, not evidence that the user edited a skill. */
const LEGACY_BUILTIN_DESCRIPTIONS: Record<string, string[]> = {
  overview: ['Use when the user requests overview.'],
  'bullet-points': ['Use when the user requests bullet points.'],
  'improve-grammar': ['Use when the user requests improve grammar & punctuation.'],
  'generate-faq': ['Use when the user requests generate faq.'],
  'extract-statistics': ['Use when the user requests extract statistics.'],
  'paraphrase-content': ['Use when the user requests paraphrase content.'],
  'create-mindmap': ['Use when the user requests create a mindmap.'],
  'article-rewrite': [
    'Rewrite the current source. Illustrate only when video frames are available. Cite screenshots with the full artifact UUID from the tool result.'
  ],
  faq: ['Build a FAQ from the current video transcript without turning it into an essay.'],
  'diagnose-task': [
    'Use when troubleshooting failed or stuck tasks, suggesting recovery, or preparing feedback for a suspected VidBee bug.'
  ]
}

/** Compare known official bodies while accounting for the former runtime feedback substitution. */
function isOfficialBody(name: string, body: string, official: string): boolean {
  if (
    name === 'translate' &&
    RETIRED_TRANSLATE_DIGESTS.has(createHash('sha256').update(body).digest('hex'))
  ) {
    return true
  }
  const normalized =
    name === 'diagnose-task'
      ? body
          .replaceAll(FEEDBACK_GITHUB_URL, '{{feedback.github}}')
          .replaceAll(FEEDBACK_EMAIL, '{{feedback.email}}')
          .replaceAll(FEEDBACK_REPORT_FILENAME, '{{feedback.filename}}')
      : body
  return normalized === official
}

/** Keep archived duplicates recoverable while excluding them from the active skill library. */
function archiveSkill(files: AgentSkillFiles, name: string): void {
  const archive = `${files.root}-legacy`
  mkdirSync(archive, { recursive: true })
  renameSync(files.directory(name), join(archive, `${name}-${randomUUID()}`))
}

/** Detect metadata changes independently of the generated name and discovery description. */
function hasCustomMetadata(
  document: ReturnType<typeof parseAgentSkill>,
  official: ReturnType<typeof parseAgentSkill>
): boolean {
  return Object.entries(document.frontmatter ?? {}).some(
    ([key, value]) =>
      !['name', 'description'].includes(key) &&
      JSON.stringify(value) !== JSON.stringify(official.frontmatter?.[key])
  )
}

/** Undo only the known erroneous legacy forks; retain explicit copies and any customized data. */
function repairOfficialDuplicates(records: AiPrompt[], files: AgentSkillFiles) {
  const kept: AiPrompt[] = []
  const recovered = new Map<string, AiPrompt>()
  const renamed = new Map<string, string>()
  for (const record of records) {
    const name = record.name.match(/^(.+)-custom(?:-\d+)?$/)?.[1]
    if (
      record.isPreset ||
      record.userCreated ||
      !name ||
      !files.isBuiltin(name) ||
      existsSync(files.directory(name))
    ) {
      kept.push(record)
      continue
    }
    const original = records.find((candidate) => candidate.name === name && candidate.isPreset)
    if (!original || original.createdAt !== record.createdAt) {
      kept.push(record)
      continue
    }
    let document: ReturnType<typeof parseAgentSkill>
    try {
      document = parseAgentSkill(files.read(record.name))
    } catch {
      kept.push(record)
      continue
    }
    const official = parseAgentSkill(files.readSource({ name, isPreset: true }))
    if (
      !(
        LEGACY_BUILTIN_DESCRIPTIONS[name]?.includes(document.description) &&
        isOfficialBody(name, document.body, official.body)
      ) ||
      hasCustomMetadata(document, official) ||
      hasCustomResources(files.directory(record.name), files.builtinDirectory(name))
    ) {
      kept.push(record)
      continue
    }
    archiveSkill(files, record.name)
    renamed.set(record.name, name)
    if ((recovered.get(name)?.updatedAt ?? Number.NEGATIVE_INFINITY) < record.updatedAt) {
      recovered.set(name, record)
    }
  }
  for (const [name, copy] of recovered) {
    const index = kept.findIndex((record) => record.name === name && record.isPreset)
    if (index >= 0 && kept[index].updatedAt > copy.updatedAt) {
      continue
    }
    const previous = index >= 0 ? kept[index] : copy
    const restored = {
      ...previous,
      name,
      isPreset: true,
      content: '',
      autoRun: copy.autoRun,
      showInTranscript: copy.showInTranscript,
      sortOrder: copy.sortOrder
    }
    if (index >= 0) {
      kept[index] = restored
    } else {
      kept.push(restored)
    }
  }
  return { skills: kept, renamed }
}

/** Detect added or modified local resources; missing newly bundled files do not imply a user edit. */
function hasCustomResources(local: string, bundled: string, root = true): boolean {
  for (const entry of readdirSync(local, { withFileTypes: true })) {
    if (root && entry.name === 'SKILL.md') {
      continue
    }
    const source = join(local, entry.name)
    const official = join(bundled, entry.name)
    if (entry.isSymbolicLink() || !existsSync(official)) {
      return true
    }
    if (entry.isDirectory()) {
      if (!lstatSync(official).isDirectory() || hasCustomResources(source, official, false)) {
        return true
      }
    } else if (
      !lstatSync(official).isFile() ||
      lstatSync(source).size > 5 * 1024 * 1024 ||
      !readFileSync(source).equals(readFileSync(official))
    ) {
      return true
    }
  }
  return false
}

/** Separate old mixed-library copies once, keeping modified instructions, resources and history as personal skills. */
export function separateBuiltinSkills(records: AiPrompt[], files: AgentSkillFiles) {
  const skills: AiPrompt[] = []
  const repaired = repairOfficialDuplicates(records, files)
  const renamed = repaired.renamed
  const reserved = new Set(repaired.skills.map((record) => record.name))
  const personalFolders = new Set(
    repaired.skills
      .filter((record) => !record.isPreset && record.directoryName)
      .map((record) => record.directoryName)
  )
  const candidates = [...repaired.skills]
  for (const seed of BUILTIN_SKILLS) {
    if (
      !(reserved.has(seed.name) || personalFolders.has(seed.name)) &&
      existsSync(files.directory(seed.name))
    ) {
      candidates.push({
        name: seed.name,
        description: seed.description,
        content: seed.content,
        isPreset: true,
        workflowOnly: !isAiPromptPresetName(seed.name),
        autoRun: false,
        sortOrder: candidates.length,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }
  }
  for (const record of candidates) {
    if (!files.isBuiltin(record.name)) {
      skills.push({ ...record, isPreset: false })
      continue
    }
    const local = files.directory(record.name)
    const hasLocal = !personalFolders.has(record.name) && existsSync(local)
    let document: ReturnType<typeof parseAgentSkill> | undefined
    if (hasLocal) {
      try {
        document = parseAgentSkill(files.read(record.name))
      } catch {
        /* Preserve malformed local files as personal copies. */
      }
    }
    if (document && document.name !== record.name && !files.isBuiltin(document.name)) {
      skills.push({ ...record, isPreset: true })
      continue
    }
    const official = parseAgentSkill(files.readSource({ ...record, isPreset: true }))
    const body = document?.body ?? record.content ?? ''
    const retired =
      record.name === 'translate' &&
      RETIRED_TRANSLATE_DIGESTS.has(createHash('sha256').update(body).digest('hex'))
    const customMetadata = document ? hasCustomMetadata(document, official) : false
    const modified =
      !record.isPreset ||
      (hasLocal && !document) ||
      customMetadata ||
      Boolean(body && !isOfficialBody(record.name, body, official.body)) ||
      Boolean(
        document &&
          document.description !== official.description &&
          !retired &&
          !LEGACY_BUILTIN_DESCRIPTIONS[record.name]?.includes(document.description)
      ) ||
      (hasLocal && hasCustomResources(local, files.builtinDirectory(record.name)))
    if (modified) {
      const name = files.availableName(record.name, reserved)
      const personal = {
        ...record,
        name,
        isPreset: false,
        description: document?.description ?? record.description,
        content: body
      }
      if (hasLocal) {
        renameSync(local, files.directory(name))
      }
      try {
        if ((document || !hasLocal) && body.trim()) {
          files.write(personal, undefined, document?.frontmatter)
        }
      } catch (error) {
        if (hasLocal) {
          renameSync(files.directory(name), local)
        }
        throw error
      }
      reserved.add(name)
      skills.push(personal)
      renamed.set(record.name, name)
    } else if (hasLocal) {
      archiveSkill(files, record.name)
    }
    skills.push({ ...record, isPreset: true, autoRun: modified ? false : record.autoRun })
  }
  return { skills, renamed }
}

/** Rewrite stored conversation references once; no runtime alias or second skill identifier remains. */
export function migrateSkillReferences(db: Database, renamed: ReadonlyMap<string, string>): void {
  if (!renamed.size) {
    return
  }
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
  )
  db.transaction(() => {
    for (const [previous, name] of renamed) {
      if (tables.has('agent_threads')) {
        db.prepare(
          "UPDATE agent_threads SET prompt_id = ?, data = json_set(data, '$.promptId', ?) WHERE prompt_id = ?"
        ).run(name, name, previous)
      }
      for (const table of ['agent_runs', 'agent_events']) {
        if (!tables.has(table)) {
          continue
        }
        for (const path of [
          '$.promptId',
          '$.thread.promptId',
          '$.catalog.summary.promptId',
          '$.run.promptId'
        ]) {
          db.prepare(
            `UPDATE ${table} SET data = json_set(data, ?, ?) WHERE json_extract(data, ?) = ?`
          ).run(path, name, path, previous)
        }
      }
      if (tables.has('transcript_prompt_runs')) {
        const rows = db
          .prepare('SELECT download_id, updated_at FROM transcript_prompt_runs WHERE prompt_id = ?')
          .all(previous) as { download_id: string; updated_at: number }[]
        for (const row of rows) {
          const current = db
            .prepare(
              'SELECT updated_at FROM transcript_prompt_runs WHERE download_id = ? AND prompt_id = ?'
            )
            .get(row.download_id, name) as { updated_at: number } | undefined
          const discarded = current && current.updated_at >= row.updated_at ? previous : name
          db.prepare(
            'DELETE FROM transcript_prompt_runs WHERE download_id = ? AND prompt_id = ?'
          ).run(row.download_id, discarded)
          db.prepare(
            'UPDATE transcript_prompt_runs SET prompt_id = ? WHERE download_id = ? AND prompt_id = ?'
          ).run(name, row.download_id, previous)
        }
      }
    }
  })()
}
