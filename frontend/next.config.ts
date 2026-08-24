import type { NextConfig } from 'next'
import { getBackendInternalUrl } from './src/shared/lib/backend-internal-url'

const backendInternal = getBackendInternalUrl()

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['@anthropic-ai/sdk'],
  experimental: {
    optimizePackageImports: ['react-chartjs-2', 'chart.js', 'zod'],
  },
  async rewrites() {
    return [
      {
        source: '/webhooks/:path*',
        destination: `${backendInternal}/webhooks/:path*`,
      },
      {
        source: '/api-backend/:path*',
        destination: `${backendInternal}/:path*`,
      },
      {
        source: '/media/:path*',
        destination: `${backendInternal}/media/:path*`,
      },
    ]
  },
}

export default nextConfig
