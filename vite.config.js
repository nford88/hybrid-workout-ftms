import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

// Get build hash from environment or generate one
const buildHash = process.env.VITE_BUILD_HASH?.slice(0, 7) || Date.now().toString(36)

export default defineConfig({
  plugins: [react()],

  // Make build hash available to the app
  define: {
    '__BUILD_HASH__': JSON.stringify(buildHash),
    '__BUILD_TIME__': JSON.stringify(process.env.VITE_BUILD_TIME || new Date().toISOString())
  },
  
  // Use src as the root directory
  root: 'src',
  
  // Build configuration
  build: {
    // Output to dist directory (relative to project root)
    outDir: '../dist',
    emptyOutDir: true,
    
    // Rollup options for optimization
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        debug: resolve(__dirname, 'src/dev/bluetooth-test.html'),
        powerCurve: resolve(__dirname, 'src/dev/power-curve-calibration.html'),
        shifting: resolve(__dirname, 'src/dev/zwift-virtual-shifting.html'),
        shiftingPoc: resolve(__dirname, 'src/dev/virtual-shifting-poc.html')

      },
      output: {
        // Use content hash + build hash for better cache busting
        entryFileNames: `assets/[name]-[hash]-${buildHash}.js`,
        chunkFileNames: `assets/[name]-[hash]-${buildHash}.js`,
        assetFileNames: `assets/[name]-[hash]-${buildHash}.[ext]`
      }
    },
    
    // Minification and optimization
    minify: 'terser',
    sourcemap: true,
    
    // Asset handling
    assetsDir: 'assets',
    
    // Chunk size warnings
    chunkSizeWarningLimit: 1000
  },
  
  // Development server
  server: {
    port: 3000,
    // Never try to launch a browser in CI: the Playwright container has no desktop, and vite's
    // `open` shells out to xdg-open. A dev server started by Playwright's `webServer` must come
    // up headless and silent.
    open: !process.env.CI,
    cors: true,
    // Bind on all interfaces under CI. Vite otherwise listens on `localhost` only, and inside a
    // container `localhost` can resolve to ::1 while the poller connects to 127.0.0.1 — which
    // presents exactly as "Timed out waiting for config.webServer" with no error to show for it.
    host: process.env.CI ? true : undefined
  },
  
  // Preview server (for testing build)
  preview: {
    port: 4173,
    open: true
  },
  
  // Public directory (for static assets)
  publicDir: '../public',
  
  // Base URL for GitHub Pages - matches repository name
  base: process.env.NODE_ENV === 'production' ? '/hybrid-workout-ftms/' : './',
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@js': resolve(__dirname, 'src/js')
    }
  }
})