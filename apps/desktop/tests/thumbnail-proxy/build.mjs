import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { builtinModules, createRequire } from 'node:module'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../../..')
const output = path.join(root, '.cache/issue-474')
await fs.mkdir(path.join(output, 'receipts'), { recursive: true })
const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'))
const { build } = createRequire(desktopRequire.resolve('electron-vite'))('esbuild')
const mainAlias = {
  name: 'workspace-aliases',
  setup(b) {
    b.onLoad({ filter: /\/shared\/builtin-skills\.ts$/ }, async (args) => {
      const documents = {}
      for (const name of await fs.readdir(path.join(root, 'skills'))) {
        const relative = `../../../../skills/${name}/SKILL.md`
        documents[relative] = await fs.readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8')
      }
      const source = await fs.readFile(args.path, 'utf8')
      return {
        contents: source.replace(
          /import\.meta\.glob<string>\([\s\S]*?\n {2}\}\)/,
          JSON.stringify(documents)
        ),
        loader: 'ts'
      }
    })
    b.onResolve({ filter: /^@vidbee\// }, (args) => ({ path: desktopRequire.resolve(args.path) }))
    b.onResolve({ filter: /^@shared\// }, (args) => ({
      path: path.join(root, 'apps/desktop/src/shared', `${args.path.slice(8)}.ts`)
    }))
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData?.resolving) {
        return
      }
      if (
        args.path === 'electron' ||
        args.path.startsWith('node:') ||
        builtinModules.includes(args.path)
      ) {
        return { path: args.path, external: true }
      }
      const resolved = await b.resolve(args.path, {
        resolveDir: args.resolveDir,
        kind: args.kind,
        pluginData: { resolving: true }
      })
      return { path: resolved.path, external: true }
    })
    b.onResolve({ filter: /^\.\.?\// }, (args) =>
      path.resolve(path.dirname(args.importer), args.path) ===
      path.join(root, 'apps/desktop/src/main/index')
        ? { path: path.join(root, 'apps/desktop/src/main/index.ts'), external: true }
        : undefined
    )
  }
}
await build({
  entryPoints: [path.join(import.meta.dirname, 'main-exports.ts')],
  outfile: path.join(output, 'main.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  nodePaths: [path.join(root, 'apps/desktop/node_modules')],
  sourcemap: true,
  banner: {
    js: `import { createRequire as __fixtureRequire } from 'node:module'; const require = __fixtureRequire(${JSON.stringify(path.join(root, 'apps/desktop/package.json'))});`
  },
  plugins: [mainAlias],
  tsconfig: path.join(root, 'apps/desktop/tsconfig.node.json'),
  logLevel: 'warning'
})
await build({
  entryPoints: [path.join(import.meta.dirname, 'renderer.tsx')],
  outfile: path.join(output, 'renderer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'true' },
  nodePaths: [path.join(root, 'apps/desktop/node_modules')],
  tsconfig: path.join(root, 'apps/desktop/tsconfig.web.json'),
  logLevel: 'warning'
})
await fs.writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>`
)
for (const name of ['runtime.cjs', 'preload.cjs', 'fixture-ytdlp.mjs']) {
  await fs.copyFile(path.join(import.meta.dirname, name), path.join(output, name))
}
console.info(
  'Built real settings/thumbnail IPC, renderer, facade and queue/executor regression fixtures.'
)

const productionFiles = [
  'apps/desktop/src/main/lib/thumbnail-cache.ts',
  'apps/desktop/src/main/ipc/services/thumbnail-service.ts',
  'apps/desktop/src/renderer/src/hooks/use-cached-thumbnail.ts'
]
const hashes = {}
for (const file of productionFiles) {
  hashes[file] = crypto
    .createHash('sha256')
    .update(await fs.readFile(path.join(root, file)))
    .digest('hex')
}
await fs.writeFile(
  path.join(output, 'receipts/source-hashes.json'),
  JSON.stringify(hashes, null, 2)
)
