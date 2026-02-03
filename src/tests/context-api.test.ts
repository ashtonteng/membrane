import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'
import * as vault from '../lib/vault'
import * as db from '../lib/db'
import { authenticateAgent, isAuthError, checkFolderAccess } from '../lib/apiAuth'

// Import route handlers
import { GET as healthGET } from '../app/api/health/route'
import { GET as foldersGET } from '../app/api/context/folders/route'
import { GET as folderGET } from '../app/api/context/folders/[folderId]/route'
import { GET as fileGET } from '../app/api/context/files/[fileId]/route'

// Helper to create a mock NextRequest
function createMockRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(new URL(url, 'http://localhost:3000'), {
    headers: new Headers(headers),
  })
  return request
}

describe('Context API', () => {
  let testDataDir: string

  beforeEach(async () => {
    // Create unique test directory for each test
    testDataDir = join(tmpdir(), `membrane-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDataDir, { recursive: true })
    process.env.MEMBRANE_DATA_DIR = testDataDir
    process.env.MEMBRANE_TEST_MODE = 'true'
    process.env.MEMBRANE_SKIP_KEYCHAIN = 'true'
    vault.reset()
    await vault.init('test-password')
  })

  afterEach(() => {
    vault.reset()
    try {
      rmSync(testDataDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('GET /api/health', () => {
    it('should return ok status and version', async () => {
      const response = await healthGET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('ok')
      expect(data.version).toBe('0.1.0')
    })
  })

  describe('API Authentication', () => {
    it('should reject requests without authorization header', () => {
      const request = createMockRequest('/api/context/folders')
      const result = authenticateAgent(request)

      expect(isAuthError(result)).toBe(true)
      if (isAuthError(result)) {
        expect(result.status).toBe(401)
        expect(result.error).toBe('unauthorized')
      }
    })

    it('should reject requests with invalid authorization format', () => {
      const request = createMockRequest('/api/context/folders', {
        Authorization: 'Basic abc123',
      })
      const result = authenticateAgent(request)

      expect(isAuthError(result)).toBe(true)
      if (isAuthError(result)) {
        expect(result.status).toBe(401)
      }
    })

    it('should reject requests with invalid API key format', () => {
      const request = createMockRequest('/api/context/folders', {
        Authorization: 'Bearer invalid_key',
      })
      const result = authenticateAgent(request)

      expect(isAuthError(result)).toBe(true)
      if (isAuthError(result)) {
        expect(result.status).toBe(401)
      }
    })

    it('should reject requests with non-existent API key', () => {
      const request = createMockRequest('/api/context/folders', {
        Authorization: 'Bearer mb_sk_nonexistent12345678901234567890',
      })
      const result = authenticateAgent(request)

      expect(isAuthError(result)).toBe(true)
      if (isAuthError(result)) {
        expect(result.status).toBe(401)
        expect(result.message).toBe('Invalid API key')
      }
    })

    it('should authenticate valid API key', () => {
      const agent = db.createAgent('Test Agent')
      const request = createMockRequest('/api/context/folders', {
        Authorization: `Bearer ${agent.api_key}`,
      })
      const result = authenticateAgent(request)

      expect(isAuthError(result)).toBe(false)
      if (!isAuthError(result)) {
        expect(result.id).toBe(agent.id)
        expect(result.name).toBe('Test Agent')
      }
    })
  })

  describe('checkFolderAccess', () => {
    it('should return error if agent has no grant', () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')

      const error = checkFolderAccess(agent.id, folder.id)

      expect(error).not.toBeNull()
      expect(error!.status).toBe(403)
      expect(error!.error).toBe('no_access')
    })

    it('should return null if agent has grant', () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      const error = checkFolderAccess(agent.id, folder.id)

      expect(error).toBeNull()
    })
  })

  describe('GET /api/context/folders', () => {
    it('should return 401 without auth', async () => {
      const request = createMockRequest('/api/context/folders')
      const response = await foldersGET(request)

      expect(response.status).toBe(401)
    })

    it('should return empty folders for agent with no grants', async () => {
      const agent = db.createAgent('Test Agent')
      const request = createMockRequest('/api/context/folders', {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await foldersGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.folders).toEqual([])
    })

    it('should return only granted folders', async () => {
      const agent = db.createAgent('Test Agent')
      const folder1 = vault.createFolder('Folder 1')
      const folder2 = vault.createFolder('Folder 2')
      vault.createFolder('Folder 3') // No grant for this one
      db.createGrant(agent.id, folder1.id)
      db.createGrant(agent.id, folder2.id)

      const request = createMockRequest('/api/context/folders', {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await foldersGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.folders.length).toBe(2)
      expect(data.folders.map((f: { name: string }) => f.name).sort()).toEqual(['Folder 1', 'Folder 2'])
    })

    it('should include file_count in response', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      // Add some files
      vault.encryptAndStore(folder.id, Buffer.from('content1'), { originalName: 'file1.txt' })
      vault.encryptAndStore(folder.id, Buffer.from('content2'), { originalName: 'file2.txt' })

      const request = createMockRequest('/api/context/folders', {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await foldersGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.folders[0].file_count).toBe(2)
    })
  })

  describe('GET /api/context/folders/[folderId]', () => {
    it('should return 401 without auth', async () => {
      const folder = vault.createFolder('Test Folder')
      const request = createMockRequest(`/api/context/folders/${folder.id}`)
      const response = await folderGET(request, { params: Promise.resolve({ folderId: folder.id }) })

      expect(response.status).toBe(401)
    })

    it('should return 403 if agent has no grant for folder', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      const request = createMockRequest(`/api/context/folders/${folder.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await folderGET(request, { params: Promise.resolve({ folderId: folder.id }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('no_access')
    })

    it('should return folder details and files', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      // Add files
      vault.encryptAndStore(folder.id, Buffer.from('content1'), {
        originalName: 'file1.txt',
        mimeType: 'text/plain',
      })
      vault.encryptAndStore(folder.id, Buffer.from('content2'), {
        originalName: 'file2.txt',
        mimeType: 'text/plain',
      })

      const request = createMockRequest(`/api/context/folders/${folder.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await folderGET(request, { params: Promise.resolve({ folderId: folder.id }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.folder.id).toBe(folder.id)
      expect(data.folder.name).toBe('Test Folder')
      expect(data.files.length).toBe(2)
      expect(data.files[0]).toHaveProperty('id')
      expect(data.files[0]).toHaveProperty('name')
      expect(data.files[0]).toHaveProperty('mime_type')
      expect(data.files[0]).toHaveProperty('size_bytes')
      expect(data.files[0]).toHaveProperty('created_at')
    })

    it('should return 404 for non-existent folder', async () => {
      const agent = db.createAgent('Test Agent')
      // Create a grant for a different folder to pass auth
      const realFolder = vault.createFolder('Real Folder')
      db.createGrant(agent.id, realFolder.id)

      const request = createMockRequest('/api/context/folders/non-existent', {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await folderGET(request, { params: Promise.resolve({ folderId: 'non-existent' }) })

      expect(response.status).toBe(403) // No grant for non-existent folder
    })
  })

  describe('GET /api/context/files/[fileId]', () => {
    it('should return 401 without auth', async () => {
      const folder = vault.createFolder('Test Folder')
      const file = vault.encryptAndStore(folder.id, Buffer.from('content'), {
        originalName: 'test.txt',
      })
      const request = createMockRequest(`/api/context/files/${file.id}`)

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })

      expect(response.status).toBe(401)
    })

    it('should return 403 if agent has no grant for file folder', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      const file = vault.encryptAndStore(folder.id, Buffer.from('content'), {
        originalName: 'test.txt',
      })

      const request = createMockRequest(`/api/context/files/${file.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('no_access')
    })

    it('should return 404 for non-existent file', async () => {
      const agent = db.createAgent('Test Agent')
      const request = createMockRequest('/api/context/files/non-existent', {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: 'non-existent' }) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('not_found')
    })

    it('should return decrypted file content with headers', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      const content = 'Hello, World!'
      const file = vault.encryptAndStore(folder.id, Buffer.from(content), {
        originalName: 'hello.txt',
        mimeType: 'text/plain',
      })

      const request = createMockRequest(`/api/context/files/${file.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/plain')
      expect(response.headers.get('X-File-Name')).toBe('hello.txt')
      expect(response.headers.get('X-File-Size')).toBe(String(content.length))

      const responseBody = await response.text()
      expect(responseBody).toBe(content)
    })

    it('should handle binary files', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      // Create binary content
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])
      const file = vault.encryptAndStore(folder.id, binaryContent, {
        originalName: 'binary.bin',
        mimeType: 'application/octet-stream',
      })

      const request = createMockRequest(`/api/context/files/${file.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')

      const responseBuffer = Buffer.from(await response.arrayBuffer())
      expect(responseBuffer.equals(binaryContent)).toBe(true)
    })

    it('should URL-encode filename in X-File-Name header', async () => {
      const agent = db.createAgent('Test Agent')
      const folder = vault.createFolder('Test Folder')
      db.createGrant(agent.id, folder.id)

      const file = vault.encryptAndStore(folder.id, Buffer.from('content'), {
        originalName: 'file with spaces & special chars.txt',
        mimeType: 'text/plain',
      })

      const request = createMockRequest(`/api/context/files/${file.id}`, {
        Authorization: `Bearer ${agent.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })

      expect(response.status).toBe(200)
      const fileName = response.headers.get('X-File-Name')
      expect(fileName).toBe(encodeURIComponent('file with spaces & special chars.txt'))
      expect(decodeURIComponent(fileName!)).toBe('file with spaces & special chars.txt')
    })
  })

  describe('Cross-agent access', () => {
    it('should prevent agent from accessing another agents folders', async () => {
      const agent1 = db.createAgent('Agent 1')
      const agent2 = db.createAgent('Agent 2')
      const folder = vault.createFolder('Agent 1 Folder')
      db.createGrant(agent1.id, folder.id) // Only agent1 has access

      // Agent 2 tries to access agent 1's folder
      const request = createMockRequest(`/api/context/folders/${folder.id}`, {
        Authorization: `Bearer ${agent2.api_key}`,
      })

      const response = await folderGET(request, { params: Promise.resolve({ folderId: folder.id }) })

      expect(response.status).toBe(403)
    })

    it('should prevent agent from accessing files in folders they dont have access to', async () => {
      const agent1 = db.createAgent('Agent 1')
      const agent2 = db.createAgent('Agent 2')
      const folder = vault.createFolder('Agent 1 Folder')
      db.createGrant(agent1.id, folder.id)

      const file = vault.encryptAndStore(folder.id, Buffer.from('secret'), {
        originalName: 'secret.txt',
      })

      // Agent 2 tries to access agent 1's file
      const request = createMockRequest(`/api/context/files/${file.id}`, {
        Authorization: `Bearer ${agent2.api_key}`,
      })

      const response = await fileGET(request, { params: Promise.resolve({ fileId: file.id }) })

      expect(response.status).toBe(403)
    })
  })
})
