/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Money Tracker',
        short_name: 'Money',
        description: 'Personal income and expense tracker',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0a0a0d',
        background_color: '#0a0a0d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
  build: {
    // The Firebase chunk alone is ~630 kB minified (~189 kB gzipped), so the default 500 kB limit would always warn.
    // The budget that matters is the gzipped JS total (350 kB); 700 still flags an unsplit bundle.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Rolldown has no object-form `manualChunks`; this group is its equivalent: all Firebase packages in one long-cached chunk.
        codeSplitting: { groups: [{ name: 'firebase', test: /node_modules[\\/](?:@firebase|firebase)[\\/]/ }] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // silences Vitest's end-of-run performance hints (Isolate/environment); they are not test output
    experimental: { diagnostics: false },
  },
})
