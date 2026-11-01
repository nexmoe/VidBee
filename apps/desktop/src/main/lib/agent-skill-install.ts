import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { z } from 'zod'
import type { GitHubSkillInstallInput, GitHubSkillSource } from '../../shared/skill-install'
import { MAX_SKILL_UPLOAD_BYTES } from '../../shared/skill-install'
import { MAX_SKILL_BYTES, parseAgentSkill } from './agent-skill-document'
import type { AgentSkillFiles } from './agent-skill-files'

interface SkillFile {
  path: string
  data: Buffer
  executable?: boolean
}

interface ZipEntry {
  entryName: string
  isDirectory: boolean
  attr: number
  header: { size: number; encrypted: boolean }
  getData: () => Buffer
}

const Zip: new (data: Buffer) => { getEntries: () => ZipEntry[] } = require('adm-zip')
const MAX_FILES = 256
const MAX_RESOURCE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const repositoryPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
const revisionPattern = /^[a-f0-9]{40}$/
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({ path: z.string(), mode: z.string(), type: z.string(), size: z.number().optional() })
  )
})

/** Reject filesystem escapes and paths with platform-dependent meanings before any write. */
function validateResourcePath(path: string): void {
  if (
    !path ||
    path.length > 1024 ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\\:]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error('Skill resources must use relative paths inside the skill directory')
  }
}

/** Install a complete validated directory atomically, leaving existing skills untouched. */
export function installSkillFiles(library: AgentSkillFiles, files: SkillFile[]): string {
  if (!files.length || files.length > MAX_FILES) {
    throw new Error('A skill must contain between 1 and 256 files')
  }
  const paths = new Set<string>()
  let total = 0
  for (const file of files) {
    validateResourcePath(file.path)
    const key = file.path.toLowerCase()
    if (paths.has(key)) {
      throw new Error('Skill files cannot contain duplicate paths')
    }
    paths.add(key)
    total += file.data.length
    if (file.data.length > MAX_RESOURCE_BYTES || total > MAX_TOTAL_BYTES) {
      throw new Error('Skill resources must fit within 5 MB per file and 25 MB in total')
    }
  }
  const document = files.find((file) => file.path === 'SKILL.md')
  if (!document || document.data.includes(0)) {
    throw new Error('The skill must contain a valid SKILL.md document')
  }
  const skill = parseAgentSkill(document.data.toString('utf8'))
  if (library.isBuiltin(skill.name)) {
    throw new Error('Personal skills cannot use a built-in skill name')
  }
  const target = library.directory(skill.name)
  if (existsSync(target)) {
    throw new Error('A skill with this name already exists')
  }
  mkdirSync(library.root, { recursive: true })
  const temporary = join(library.root, `.install-${randomUUID()}`)
  mkdirSync(temporary)
  try {
    for (const file of files) {
      const destination = join(temporary, file.path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, file.data, { flag: 'wx', mode: file.executable ? 0o700 : 0o600 })
    }
    if (existsSync(target)) {
      throw new Error('A skill with this name already exists')
    }
    renameSync(temporary, target)
    return skill.name
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/** Read one portable document or a ZIP containing exactly one skill and its supporting files. */
export function readSkillUpload(name: string, bytes: Uint8Array): SkillFile[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SKILL_UPLOAD_BYTES) {
    throw new Error('Skill uploads must fit within 10 MB')
  }
  const data = Buffer.from(bytes)
  if (name.toLowerCase().endsWith('.md')) {
    return [{ path: 'SKILL.md', data }]
  }
  if (!name.toLowerCase().endsWith('.zip')) {
    throw new Error('Upload a SKILL.md document or a ZIP containing one skill')
  }
  const entries = new Zip(data).getEntries()
  if (entries.length > MAX_FILES * 2) {
    throw new Error('A skill ZIP contains too many entries')
  }
  const files = entries.filter(
    (entry) => !(entry.isDirectory || entry.entryName.startsWith('__MACOSX/'))
  )
  let total = 0
  for (const entry of files) {
    validateResourcePath(entry.entryName)
    total += entry.header.size
    // biome-ignore lint/suspicious/noBitwiseOperators: ZIP external attributes encode the POSIX file type in their upper bits.
    const symbolicLink = ((entry.attr >>> 16) & 0o17_0000) === 0o12_0000
    if (
      symbolicLink ||
      entry.header.encrypted ||
      entry.header.size > MAX_RESOURCE_BYTES ||
      total > MAX_TOTAL_BYTES
    ) {
      throw new Error('Skill ZIPs cannot contain links, encrypted files or oversized resources')
    }
  }
  const documents = files.filter((entry) => posix.basename(entry.entryName) === 'SKILL.md')
  if (documents.length !== 1) {
    throw new Error('Upload a ZIP containing exactly one SKILL.md')
  }
  const prefix = documents[0].entryName.slice(0, -'SKILL.md'.length)
  return files
    .filter((entry) => entry.entryName.startsWith(prefix))
    .map((entry) => ({
      path: entry.entryName.slice(prefix.length),
      data: entry.getData(),
      // biome-ignore lint/suspicious/noBitwiseOperators: Preserve executable bits encoded in ZIP external file attributes.
      executable: Boolean((entry.attr >>> 16) & 0o111)
    }))
}

/** Read bounded GitHub responses without following redirects to unrelated hosts. */
async function githubBytes(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VidBee' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `GitHub returned ${response.status}. Check the public repository URL or try again later.`
    )
  }
  if (!response.body) {
    throw new Error('GitHub returned an empty response')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > limit) {
        throw new Error('The GitHub response is too large to import')
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

/** Read structured API data while keeping network bounds in one place. */
async function githubJson(path: string): Promise<unknown> {
  return JSON.parse(
    (await githubBytes(`https://api.github.com/repos/${path}`, 8 * 1024 * 1024)).toString('utf8')
  )
}

/** Inspect an immutable repository revision and fail explicitly on incomplete GitHub trees. */
async function githubTree(repository: string, revision: string) {
  if (!(repositoryPattern.test(repository) && revisionPattern.test(revision))) {
    throw new Error('Invalid GitHub repository or revision')
  }
  const tree = treeSchema.parse(await githubJson(`${repository}/git/trees/${revision}?recursive=1`))
  if (tree.truncated) {
    throw new Error('This repository is too large. Upload the skill as a ZIP instead.')
  }
  return tree.tree
}

/** Resolve public repository, directory and SKILL.md links, including refs containing slashes. */
export async function inspectGitHubSkills(value: string): Promise<GitHubSkillSource> {
  const url = new URL(value.trim())
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('Enter an HTTPS github.com repository or skill directory URL')
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent)
  const repository = `${parts[0]}/${parts[1]?.replace(/\.git$/, '')}`
  if (
    !repositoryPattern.test(repository) ||
    (parts.length > 2 && !['tree', 'blob'].includes(parts[2]))
  ) {
    throw new Error('Enter a GitHub repository, directory or SKILL.md URL')
  }
  let revision = ''
  let directory = ''
  if (parts.length === 2) {
    const commit = z
      .object({ sha: z.string().regex(revisionPattern) })
      .parse(await githubJson(`${repository}/commits/HEAD`))
    revision = commit.sha
  } else {
    const tail = parts.slice(3)
    if (parts[2] === 'blob' && tail.pop() !== 'SKILL.md') {
      throw new Error('The selected file must be SKILL.md')
    }
    if (!tail.length || tail.length > 16) {
      throw new Error('Invalid GitHub skill path')
    }
    for (let length = tail.length; length > 0; length -= 1) {
      try {
        const commit = z
          .object({ sha: z.string().regex(revisionPattern) })
          .parse(
            await githubJson(
              `${repository}/commits/${encodeURIComponent(tail.slice(0, length).join('/'))}`
            )
          )
        revision = commit.sha
        directory = tail.slice(length).join('/')
        break
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            (error.message.startsWith('GitHub returned 404.') ||
              error.message.startsWith('GitHub returned 422.'))
          )
        ) {
          throw error
        }
      }
    }
  }
  if (!revision) {
    throw new Error('The GitHub branch or revision could not be found')
  }
  const tree = await githubTree(repository, revision)
  const prefix = directory ? `${directory}/` : ''
  const paths = tree
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.mode !== '120000' &&
        entry.path.startsWith(prefix) &&
        posix.basename(entry.path) === 'SKILL.md'
    )
    .map((entry) => entry.path)
  if (!paths.length || paths.length > 100) {
    throw new Error(
      'No skills found, or too many skills. Use a link to a specific skill directory.'
    )
  }
  return { repository, revision, paths }
}

/** Download only the selected skill at the inspected commit, without running any repository code. */
export async function readGitHubSkill(input: GitHubSkillInstallInput): Promise<SkillFile[]> {
  validateResourcePath(input.path)
  if (posix.basename(input.path) !== 'SKILL.md') {
    throw new Error('Select a SKILL.md document')
  }
  const tree = await githubTree(input.repository, input.revision)
  if (!tree.some((entry) => entry.path === input.path && entry.type === 'blob')) {
    throw new Error('The selected skill was not found')
  }
  const prefix = input.path.slice(0, -'SKILL.md'.length)
  const entries = tree.filter((entry) => entry.path.startsWith(prefix) && entry.type !== 'tree')
  if (entries.length > MAX_FILES) {
    throw new Error('A skill cannot contain more than 256 files')
  }
  let total = 0
  for (const entry of entries) {
    total += entry.size ?? 0
    if (
      !['100644', '100755'].includes(entry.mode) ||
      entry.type !== 'blob' ||
      (entry.size ?? 0) > MAX_RESOURCE_BYTES ||
      total > MAX_TOTAL_BYTES
    ) {
      throw new Error('The skill contains links, submodules or oversized resources')
    }
  }
  const files: SkillFile[] = []
  total = 0
  for (const entry of entries) {
    const path = entry.path.slice(prefix.length)
    validateResourcePath(path)
    const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
    const data = await githubBytes(
      `https://raw.githubusercontent.com/${input.repository}/${input.revision}/${encoded}`,
      path === 'SKILL.md' ? MAX_SKILL_BYTES : MAX_RESOURCE_BYTES
    )
    total += data.length
    if (total > MAX_TOTAL_BYTES) {
      throw new Error('Skill resources exceed 25 MB')
    }
    files.push({ path, data, executable: entry.mode === '100755' })
  }
  return files
}
