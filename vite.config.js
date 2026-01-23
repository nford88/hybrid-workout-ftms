import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
        shifting: resolve(__dirname, 'src/dev/zwift-virtual-shifting.html')
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