import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: '../api/openapi.json',
  output: { path: 'src/lib/api/generated' },
  plugins: [
    { name: '@hey-api/client-fetch', runtimeConfigPath: './src/lib/api/client-config' },
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
})
