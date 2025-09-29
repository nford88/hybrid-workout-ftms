#!/usr/bin/env node

// Simple test runner script
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log('🚴‍♂️ FTMS Hybrid Workout App - Test Runner')
console.log('=========================================\n')

// Check if we're in the right directory
const packageJsonPath = join(__dirname, '..', 'package.json')

try {
  const packageJson = await import(packageJsonPath, { assert: { type: 'json' } })
  console.log(`📦 Running tests for: ${packageJson.default.name}`)
} catch (error) {
  console.log('⚠️  No package.json found. Run `npm install` first.')
  process.exit(1)
}

// Parse command line arguments
const args = process.argv.slice(2)
const testType = args[0] || 'test'

const testCommands = {
  'test': ['npm', 'test'],
  'ui': ['npm', 'run', 'test:ui'],
  'coverage': ['npm', 'run', 'test:coverage'],
  'watch': ['npm', 'run', 'test:watch']
}

if (!testCommands[testType]) {
  console.log('❌ Invalid test type. Available options:')
  console.log('   • test      - Run all tests')
  console.log('   • ui        - Run tests with UI')
  console.log('   • coverage  - Run tests with coverage')
  console.log('   • watch     - Run tests in watch mode')
  process.exit(1)
}

console.log(`🧪 Running: ${testCommands[testType].join(' ')}\n`)

// Run the test command
const testProcess = spawn(testCommands[testType][0], testCommands[testType].slice(1), {
  stdio: 'inherit',
  cwd: join(__dirname, '..')
})

testProcess.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ Tests completed successfully!')
  } else {
    console.log('\n❌ Tests failed!')
    process.exit(code)
  }
})