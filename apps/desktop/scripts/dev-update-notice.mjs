import { spawn } from 'node:child_process'

const child = spawn('pnpm', ['run', 'dev'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    VITE_FORCE_UPDATE_NOTICE: '1',
    VITE_FORCE_CURRENT_VERSION: '1.3.0',
    VITE_FORCE_LATEST_VERSION: '1.3.8'
  },
  shell: true,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
