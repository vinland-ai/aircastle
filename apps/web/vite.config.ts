import process from 'node:process'
import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, lazyPlugins, loadEnv, type Plugin } from 'vite-plus'

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const envDir = fileURLToPath(new URL('../../', import.meta.url))
const fixtureModules = new Map([
  [source('./src/components/shell/data.ts'), source('./e2e/fixture-modules/shell-data.ts')],
  [
    source('./src/features/navigation/pages.ts'),
    source('./e2e/fixture-modules/navigation-pages.ts'),
  ],
])
const landingModules = new Map([[source('./src/router.tsx'), source('./src/landing-router.tsx')]])

function swapModules(name: string, swaps: Map<string, string>): Plugin {
  const swapped = new Set<string>()
  return {
    name,
    enforce: 'pre',
    async resolveId(specifier, importer, options) {
      const resolved = await this.resolve(specifier, importer, { ...options, skipSelf: true })
      const swap = resolved && swaps.get(resolved.id)
      if (!swap || importer === swap) return resolved
      swapped.add(resolved.id)
      return swap
    },
    generateBundle() {
      const missed = [...swaps.keys()].filter((original) => !swapped.has(original))
      if (missed.length > 0) this.error(`${name} never replaced ${missed.join(', ')}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  return {
    envDir,
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.{ts,tsx}'],
      allowOnly: false,
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/test-utils.tsx'],
        reporter: ['text', 'html', 'json', 'json-summary'],
      },
      setupFiles: ['./src/test-setup.ts'],
    },
    resolve: { alias: [{ find: '@', replacement: source('./src') }] },
    server: {
      port: 43121,
      strictPort: true,
      proxy:
        mode === 'landing'
          ? {}
          : { '^/api(?:/|$)': { target: `http://127.0.0.1:${env.PORT ?? 43122}` } },
    },
    preview: { port: 43121, strictPort: true },
    plugins:
      lazyPlugins(() => [
        ...(process.env.WEB_FIXTURES === '1' ? [swapModules('fixture-data', fixtureModules)] : []),
        ...(mode === 'landing' ? [swapModules('landing-only', landingModules)] : []),
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
      ]) ?? [],
  }
})
