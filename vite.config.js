import { defineConfig } from 'vite'
import { resolve } from 'path'

// Get build hash from environment or generate one
const buildHash = process.env.VITE_BUILD_HASH?.slice(0, 7) || Date.now().toString(36)

export default defineConfig({
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
    open: true,
    cors: true
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