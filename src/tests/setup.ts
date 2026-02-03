import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Generate unique test data directory for each test run
const testDataDir = join(tmpdir(), `membrane-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// Set environment variables for tests
process.env.MEMBRANE_TEST_MODE = 'true'
process.env.MEMBRANE_SKIP_KEYCHAIN = 'true'
process.env.MEMBRANE_DATA_DIR = testDataDir

// Create test data directory
mkdirSync(testDataDir, { recursive: true })

// Cleanup after all tests
afterAll(() => {
  try {
    rmSync(testDataDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
})

export { testDataDir }
