import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { AiPrompt } from '../../shared/ai-types'
import { BUILTIN_SKILLS } from '../../shared/builtin-skills'
import { formatAgentSkillDocument, MAX_SKILL_BYTES, parseAgentSkill } from './agent-skill-document'

type SkillSource = Pick<AiPrompt, 'name' | 'isPreset' | 'directoryName'>

/** Keep read-only bundled skills separate from the user's writable skill library. */
export class AgentSkillFiles {
  readonly root: string
  private readonly builtinRoot?: string

  /** Use an explicit root so development and tests never touch another profile. */
  constructor(root: string, builtinRoot?: string) {
    this.root = root
    this.builtinRoot = builtinRoot
    mkdirSync(root, { recursive: true })
  }

  /** Reserve official invocation names independently of the files in user storage. */
  isBuiltin(name: string): boolean {
    return BUILTIN_SKILLS.some((skill) => skill.name === name)
  }

  /** Resolve an official skill only from the application bundle. */
  builtinDirectory(name: string): string {
    if (!(this.builtinRoot && this.isBuiltin(name))) {
      throw new Error('Bundled skill directory is unavailable')
    }
    return join(this.builtinRoot, name)
  }

  /** Select the source root explicitly; personal skills never shadow official names. */
  sourceDirectory(prompt: SkillSource): string {
    return prompt.isPreset
      ? this.builtinDirectory(prompt.name)
      : this.directory(prompt.directoryName ?? prompt.name)
  }

  /** Allocate a distinct name for a personal copy without colliding with folders. */
  availableName(name: string, reserved: Iterable<string> = []): string {
    const names = new Set(reserved)
    const base = `${name}-custom`
    let candidate = base
    let suffix = 1
    while (
      names.has(candidate) ||
      this.isBuiltin(candidate) ||
      existsSync(this.directory(candidate))
    ) {
      candidate = `${base}-${++suffix}`
    }
    return candidate
  }

  /** Resolve only a validated skill directory inside this library. */
  directory(name: string): string {
    formatAgentSkillDocument({ name, description: 'Skill', body: 'Skill' })
    const directory = join(this.root, name)
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
      throw new Error('Skill directories cannot be symbolic links')
    }
    return directory
  }

  /** Read bounded text resources without permitting traversal or symlink escapes. */
  read(name: string, resource = 'SKILL.md'): string {
    return this.readDirectory(this.directory(name), resource)
  }

  /** Read the actual bundled or personal document selected for invocation and export. */
  readSource(prompt: SkillSource, resource = 'SKILL.md'): string {
    if (prompt.isPreset && !this.builtinRoot && resource === 'SKILL.md') {
      const seed = BUILTIN_SKILLS.find((skill) => skill.name === prompt.name)
      if (seed) {
        return seed.document
      }
    }
    return this.readDirectory(this.sourceDirectory(prompt), resource)
  }

  /** Bound text reads to one skill directory and reject traversal and escaping symlinks. */
  private readDirectory(root: string, resource: string): string {
    const directory = realpathSync(root)
    if (isAbsolute(resource) || resource.split(/[\\/]/).includes('..')) {
      throw new Error('Skill resources must stay inside their skill directory')
    }
    const file = realpathSync(join(directory, resource))
    const inside = relative(directory, file)
    if (!inside || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error('Skill resources must stay inside their skill directory')
    }
    const stats = statSync(file)
    if (!stats.isFile() || stats.size > MAX_SKILL_BYTES) {
      throw new Error('Skill resources must be text files within 128 KB')
    }
    const content = readFileSync(file, 'utf8')
    if (content.includes('\0')) {
      throw new Error('Only text skill resources are supported')
    }
    return content
  }

  /** Atomically save the document, preserving supporting resources when renaming a skill. */
  write(
    prompt: AiPrompt,
    previousName?: string,
    importedFrontmatter?: Record<string, unknown>
  ): void {
    if (this.isBuiltin(prompt.name)) {
      throw new Error('Built-in skills are read-only; create a custom copy first')
    }
    let frontmatter = importedFrontmatter
    const targetName = prompt.directoryName ?? prompt.name
    const previous = join(this.directory(previousName ?? targetName), 'SKILL.md')
    if (!frontmatter && existsSync(previous)) {
      try {
        frontmatter = parseAgentSkill(this.read(previousName ?? targetName)).frontmatter
      } catch {
        // A valid update can repair an invalid document.
      }
    }
    const document = formatAgentSkillDocument({
      name: prompt.name,
      description: prompt.description ?? prompt.name,
      body: prompt.content,
      frontmatter
    })
    const directory = this.directory(targetName)
    mkdirSync(this.root, { recursive: true })
    let movedFrom: string | undefined
    if (previousName && previousName !== targetName) {
      if (existsSync(directory)) {
        throw new Error('A skill with this name already exists')
      }
      const previous = this.directory(previousName)
      if (existsSync(previous)) {
        renameSync(previous, directory)
        movedFrom = previous
      }
    }
    mkdirSync(directory, { recursive: true })
    const temporary = join(directory, `.SKILL-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, document, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, join(directory, 'SKILL.md'))
    } catch (error) {
      rmSync(temporary, { force: true })
      if (movedFrom) {
        renameSync(directory, movedFrom)
      }
      throw error
    }
  }

  /** Copy a complete skill into user storage without modifying its source or supporting resources. */
  copy(prompt: AiPrompt, name: string): void {
    const target = this.directory(name)
    if (this.isBuiltin(name) || existsSync(target)) {
      throw new Error('A skill with this name already exists')
    }
    const skill = parseAgentSkill(this.readSource(prompt))
    const temporary = join(this.root, `.copy-${randomUUID()}`)
    try {
      cpSync(this.sourceDirectory(prompt), temporary, {
        recursive: true,
        errorOnExist: true,
        force: false
      })
      const document = formatAgentSkillDocument({ ...skill, name })
      const staged = join(temporary, '.SKILL-copy.tmp')
      writeFileSync(staged, document, { flag: 'wx' })
      renameSync(staged, join(temporary, 'SKILL.md'))
      if (existsSync(target)) {
        throw new Error('A skill with this name already exists')
      }
      renameSync(temporary, target)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }

  /** Hydrate official instructions from the bundle and personal instructions from user storage. */
  hydrate(prompt: AiPrompt, seed = false): AiPrompt {
    const legacy = prompt as AiPrompt & { title?: string; scope?: unknown; enabled?: boolean }
    const name = prompt.name
    const description =
      prompt.description ?? `Use when the user requests ${(legacy.title ?? name).toLowerCase()}.`
    const { skillError: _error, title: _title, scope: _scope, enabled: _enabled, ...saved } = legacy
    const migrated = { ...saved, name, description }
    try {
      if (!prompt.isPreset && this.isBuiltin(name)) {
        throw new Error('Personal skills cannot use a built-in skill name')
      }
      if (!prompt.isPreset && seed && !existsSync(join(this.sourceDirectory(prompt), 'SKILL.md'))) {
        this.write(migrated)
      }
      const skill = parseAgentSkill(this.readSource(prompt))
      if (!prompt.isPreset && this.isBuiltin(skill.name)) {
        throw new Error('Personal skills cannot use a built-in skill name')
      }
      const directoryName = prompt.directoryName ?? name
      return {
        ...migrated,
        name: skill.name,
        directoryName: prompt.isPreset || directoryName === skill.name ? undefined : directoryName,
        description: skill.description,
        content: skill.body
      }
    } catch (error) {
      return { ...migrated, skillError: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Remove only the managed skill directory explicitly selected for deletion. */
  remove(name: string, directoryName = name): void {
    if (this.isBuiltin(name)) {
      throw new Error('Built-in skills are read-only; hide their transcript shortcut instead')
    }
    rmSync(this.directory(directoryName), { recursive: true, force: true })
  }

  /** Hide removed personal directories without discarding their saved preferences or history. */
  installed(known: AiPrompt[]): AiPrompt[] {
    const entries = new Set(existsSync(this.root) ? readdirSync(this.root) : [])
    return known.filter(
      (prompt) => prompt.isPreset || entries.has(prompt.directoryName ?? prompt.name)
    )
  }

  /** Follow authored names and moved folders while retaining the registered skill's preferences. */
  synchronize(known: AiPrompt[]): { skills: AiPrompt[]; renamed: Map<string, string> } {
    const skills = known.map((prompt) => this.hydrate(prompt))
    const renamed = new Map<string, string>()
    for (const [index, skill] of skills.entries()) {
      const previous = known[index]
      if (skill.skillError || skill.name === previous.name || skill.isPreset) {
        continue
      }
      if (
        known.some((other) => other !== previous && other.name === skill.name) ||
        skills.some((other) => other !== skill && other.name === skill.name)
      ) {
        skills[index] = { ...previous, skillError: 'A skill with this name already exists' }
        continue
      }
      skill.userCreated = true
      renamed.set(previous.name, skill.name)
    }
    for (const discovered of this.discover(this.installed(skills))) {
      const index = skills.findIndex((skill) => !skill.isPreset && skill.name === discovered.name)
      if (index < 0) {
        skills.push(discovered)
      } else {
        skills[index] = {
          ...skills[index],
          directoryName: discovered.directoryName,
          description: discovered.description,
          content: discovered.content,
          userCreated: true,
          skillError: undefined
        }
      }
    }
    return { skills, renamed }
  }

  /** Coalesce external file changes without polling or keeping the application alive. */
  watch(onChange: () => void, onError: (error: Error) => void): () => void {
    let pending: ReturnType<typeof setTimeout> | undefined
    const watcher = watch(this.root, { recursive: true, persistent: false }, () => {
      clearTimeout(pending)
      pending = setTimeout(onChange, 150)
      pending.unref()
    })
    watcher.on('error', onError)
    return () => {
      clearTimeout(pending)
      watcher.close()
    }
  }

  /** Discover installed directories without following links or overwriting registered settings. */
  discover(known: AiPrompt[]): AiPrompt[] {
    if (!existsSync(this.root)) {
      return []
    }
    const names = new Set(known.map((prompt) => prompt.name))
    const folders = new Set(
      known
        .filter((prompt) => !prompt.isPreset)
        .map((prompt) => prompt.directoryName ?? prompt.name)
    )
    const discovered: AiPrompt[] = []
    for (const directory of readdirSync(this.root, { withFileTypes: true })) {
      if (!directory.isDirectory() || folders.has(directory.name)) {
        continue
      }
      try {
        const skill = parseAgentSkill(this.read(directory.name))
        if (this.isBuiltin(skill.name) || names.has(skill.name)) {
          continue
        }
        names.add(skill.name)
        discovered.push({
          name: skill.name,
          directoryName: directory.name === skill.name ? undefined : directory.name,
          description: skill.description,
          content: skill.body,
          autoRun: false,
          isPreset: false,
          userCreated: true,
          sortOrder: known.length + discovered.length,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      } catch {
        // Unregistered invalid folders cannot become callable skills.
      }
    }
    return discovered
  }
}
