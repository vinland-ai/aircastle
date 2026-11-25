import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async redirects() {
    return [
      {
        source: '/dash',
        destination: '/dash/workspaces/demo/projects/demo/collections',
        permanent: false,
      },
      {
        source: '/dash/workspaces/:workspaceId/projects/:projectId',
        destination: '/dash/workspaces/:workspaceId/projects/:projectId/collections',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
