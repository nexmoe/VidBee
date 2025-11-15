import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/lib/database/schema.ts',
  out: './resources/drizzle',
  dialect: 'sqlite'
})
