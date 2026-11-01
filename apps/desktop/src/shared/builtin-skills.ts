import { parse } from 'yaml'

/** Repository skill files are the only authored source for built-in names, descriptions and instructions. */
export const BUILTIN_SKILLS = Object.values(
  import.meta.glob<string>('../../../../skills/*/SKILL.md', {
    eager: true,
    query: '?raw',
    import: 'default'
  })
).map((document) => {
  const match = document.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match?.[1]) {
    throw new Error('Built-in SKILL.md requires YAML frontmatter')
  }
  const metadata = parse(match[1]) as { name: string; description: string }
  return {
    name: metadata.name,
    description: metadata.description,
    content: document.slice(match[0].length).trim(),
    document
  }
})
