import { config } from 'dotenv'
import path from 'node:path'
config({ path: '.env.local' })
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/api-contract/**/*.test.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: './test-results-contract.json' },
    testTimeout: 60000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
