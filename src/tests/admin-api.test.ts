import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as vault from '../lib/vault'

// Import route handlers
import { POST as setupPost } from '../app/api/admin/setup/route'
import { GET as vaultStatusGet } from '../app/api/admin/vault/status/route'
import { POST as foldersPost, GET as foldersGet } from '../app/api/admin/folders/route'
import { GET as folderGet, PATCH as folderPatch, DELETE as folderDelete } from '../app/api/admin/folders/[folderId]/route'
import { POST as filesPost, GET as filesGet } from '../app/api/admin/folders/[folderId]/files/route'
import { GET as fileGet, DELETE as fileDelete } from '../app/api/admin/files/[id]/route'
import { GET as fileMetadataGet } from '../app/api/admin/files/[id]/metadata/route'

// Helper to create a mock NextRequest
function createRequest(
  url: string,
  options: {
    method?: string
    body?: Record<string, unknown>
    formData?: FormData
  } = {}
): Request {
  const { method = 'GET', body, formData } = options

  const requestInit: RequestInit = {
    method,
  }

  if (body) {
    requestInit.body = JSON.stringify(body)
    requestInit.headers = {
      'Content-Type': 'application/json',
    }
  }

  if (formData) {
    requestInit.body = formData
  }

  return new Request(`http://localhost:3000${url}`, requestInit)
}

// Helper to create route context with params
function createContext<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

describe('Admin API', () => {
  let testDataDir: string

  beforeAll(() => {
    // Set test mode environment variables
    process.env.MEMBRANE_TEST_MODE = 'true'
    process.env.MEMBRANE_SKIP_KEYCHAIN = 'true'
  })

  afterAll(() => {
    delete process.env.MEMBRANE_TEST_MODE
    delete process.env.MEMBRANE_SKIP_KEYCHAIN
  })

  beforeEach(() => {
    // Create unique test directory for each test
    testDataDir = join(tmpdir(), `membrane-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDataDir, { recursive: true })
    process.env.MEMBRANE_DATA_DIR = testDataDir
    vault.reset()
  })

  afterEach(() => {
    vault.reset()
    try {
      rmSync(testDataDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('POST /api/admin/setup', () => {
    it('should initialize vault with valid password', async () => {
      const request = createRequest('/api/admin/setup', {
        method: 'POST',
        body: { recoveryPassword: 'test-password-123' },
      })

      const response = await setupPost(request as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(vault.isInitialized()).toBe(true)
    })

    it('should reject if recoveryPassword is missing', async () => {
      const request = createRequest('/api/admin/setup', {
        method: 'POST',
        body: {},
      })

      const response = await setupPost(request as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Bad Request')
    })

    it('should reject if recoveryPassword is too short', async () => {
      const request = createRequest('/api/admin/setup', {
        method: 'POST',
        body: { recoveryPassword: 'short' },
      })

      const response = await setupPost(request as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.message).toContain('at least 8 characters')
    })

    it('should return 409 if vault already initialized', async () => {
      // Initialize first
      await vault.init('test-password-123')

      const request = createRequest('/api/admin/setup', {
        method: 'POST',
        body: { recoveryPassword: 'another-password' },
      })

      const response = await setupPost(request as any)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBe('Conflict')
    })
  })

  describe('GET /api/admin/vault/status', () => {
    it('should return initialized: false when not initialized', async () => {
      const response = await vaultStatusGet()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.initialized).toBe(false)
    })

    it('should return initialized: true when initialized', async () => {
      await vault.init('test-password-123')

      const response = await vaultStatusGet()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.initialized).toBe(true)
    })
  })

  describe('Folders CRUD', () => {
    beforeEach(async () => {
      await vault.init('test-password-123')
    })

    describe('POST /api/admin/folders', () => {
      it('should create a folder', async () => {
        const request = createRequest('/api/admin/folders', {
          method: 'POST',
          body: { name: 'Test Folder' },
        })

        const response = await foldersPost(request as any)
        const data = await response.json()

        expect(response.status).toBe(201)
        expect(data.id).toBeDefined()
        expect(data.name).toBe('Test Folder')
        expect(data.created_at).toBeDefined()
      })

      it('should reject empty name', async () => {
        const request = createRequest('/api/admin/folders', {
          method: 'POST',
          body: { name: '   ' },
        })

        const response = await foldersPost(request as any)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.message).toContain('empty')
      })

      it('should reject missing name', async () => {
        const request = createRequest('/api/admin/folders', {
          method: 'POST',
          body: {},
        })

        const response = await foldersPost(request as any)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.message).toContain('required')
      })
    })

    describe('GET /api/admin/folders', () => {
      it('should return empty list when no folders', async () => {
        const response = await foldersGet()
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.folders).toEqual([])
      })

      it('should return list of folders', async () => {
        vault.createFolder('Folder 1')
        vault.createFolder('Folder 2')

        const response = await foldersGet()
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.folders.length).toBe(2)
        expect(data.folders.map((f: any) => f.name)).toContain('Folder 1')
        expect(data.folders.map((f: any) => f.name)).toContain('Folder 2')
      })
    })

    describe('GET /api/admin/folders/[folderId]', () => {
      it('should return folder by id', async () => {
        const folder = vault.createFolder('Test Folder')
        const request = createRequest(`/api/admin/folders/${folder.id}`)
        const context = createContext({ folderId: folder.id })

        const response = await folderGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.id).toBe(folder.id)
        expect(data.name).toBe('Test Folder')
        expect(data.file_count).toBe(0)
      })

      it('should return 404 for non-existent folder', async () => {
        const request = createRequest('/api/admin/folders/non-existent')
        const context = createContext({ folderId: 'non-existent' })

        const response = await folderGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })

    describe('PATCH /api/admin/folders/[folderId]', () => {
      it('should rename folder', async () => {
        const folder = vault.createFolder('Old Name')
        const request = createRequest(`/api/admin/folders/${folder.id}`, {
          method: 'PATCH',
          body: { name: 'New Name' },
        })
        const context = createContext({ folderId: folder.id })

        const response = await folderPatch(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.name).toBe('New Name')
        expect(data.updated_at).toBeDefined()
      })

      it('should return 404 for non-existent folder', async () => {
        const request = createRequest('/api/admin/folders/non-existent', {
          method: 'PATCH',
          body: { name: 'New Name' },
        })
        const context = createContext({ folderId: 'non-existent' })

        const response = await folderPatch(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })

    describe('DELETE /api/admin/folders/[folderId]', () => {
      it('should delete folder', async () => {
        const folder = vault.createFolder('To Delete')
        const request = createRequest(`/api/admin/folders/${folder.id}`, {
          method: 'DELETE',
        })
        const context = createContext({ folderId: folder.id })

        const response = await folderDelete(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
        expect(vault.getFolder(folder.id)).toBeNull()
      })

      it('should return 404 for non-existent folder', async () => {
        const request = createRequest('/api/admin/folders/non-existent', {
          method: 'DELETE',
        })
        const context = createContext({ folderId: 'non-existent' })

        const response = await folderDelete(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })
  })

  describe('Files API', () => {
    let folderId: string

    beforeEach(async () => {
      await vault.init('test-password-123')
      const folder = vault.createFolder('Test Folder')
      folderId = folder.id
    })

    describe('POST /api/admin/folders/[folderId]/files', () => {
      it('should upload a file', async () => {
        const formData = new FormData()
        const fileContent = new Blob(['Hello, World!'], { type: 'text/plain' })
        formData.append('file', fileContent, 'test.txt')

        const request = createRequest(`/api/admin/folders/${folderId}/files`, {
          method: 'POST',
          formData,
        })
        const context = createContext({ folderId })

        const response = await filesPost(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(201)
        expect(data.id).toBeDefined()
        expect(data.original_name).toBe('test.txt')
        expect(data.mime_type).toBe('text/plain')
        expect(data.size_bytes).toBe(13)
      })

      it('should return 404 for non-existent folder', async () => {
        const formData = new FormData()
        const fileContent = new Blob(['Hello'], { type: 'text/plain' })
        formData.append('file', fileContent, 'test.txt')

        const request = createRequest('/api/admin/folders/non-existent/files', {
          method: 'POST',
          formData,
        })
        const context = createContext({ folderId: 'non-existent' })

        const response = await filesPost(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })

      it('should return 400 when file is missing', async () => {
        const formData = new FormData()

        const request = createRequest(`/api/admin/folders/${folderId}/files`, {
          method: 'POST',
          formData,
        })
        const context = createContext({ folderId })

        const response = await filesPost(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.message).toContain('required')
      })
    })

    describe('GET /api/admin/folders/[folderId]/files', () => {
      it('should list files in folder', async () => {
        vault.encryptAndStore(folderId, Buffer.from('Content 1'), { originalName: 'file1.txt' })
        vault.encryptAndStore(folderId, Buffer.from('Content 2'), { originalName: 'file2.txt' })

        const request = createRequest(`/api/admin/folders/${folderId}/files`)
        const context = createContext({ folderId })

        const response = await filesGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.files.length).toBe(2)
      })

      it('should return 404 for non-existent folder', async () => {
        const request = createRequest('/api/admin/folders/non-existent/files')
        const context = createContext({ folderId: 'non-existent' })

        const response = await filesGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })

    describe('GET /api/admin/files/[id]', () => {
      it('should return decrypted file content', async () => {
        const file = vault.encryptAndStore(folderId, Buffer.from('Hello, World!'), {
          originalName: 'test.txt',
          mimeType: 'text/plain',
        })

        const request = createRequest(`/api/admin/files/${file.id}`)
        const context = createContext({ id: file.id })

        const response = await fileGet(request as any, context)

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/plain')
        expect(response.headers.get('Content-Disposition')).toContain('test.txt')

        const content = await response.text()
        expect(content).toBe('Hello, World!')
      })

      it('should return 404 for non-existent file', async () => {
        const request = createRequest('/api/admin/files/non-existent')
        const context = createContext({ id: 'non-existent' })

        const response = await fileGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })

    describe('GET /api/admin/files/[id]/metadata', () => {
      it('should return file metadata', async () => {
        const file = vault.encryptAndStore(folderId, Buffer.from('Hello'), {
          originalName: 'test.txt',
          mimeType: 'text/plain',
        })

        const request = createRequest(`/api/admin/files/${file.id}/metadata`)
        const context = createContext({ id: file.id })

        const response = await fileMetadataGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.id).toBe(file.id)
        expect(data.original_name).toBe('test.txt')
        expect(data.mime_type).toBe('text/plain')
        expect(data.size_bytes).toBe(5)
      })

      it('should return 404 for non-existent file', async () => {
        const request = createRequest('/api/admin/files/non-existent/metadata')
        const context = createContext({ id: 'non-existent' })

        const response = await fileMetadataGet(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })

    describe('DELETE /api/admin/files/[id]', () => {
      it('should delete file', async () => {
        const file = vault.encryptAndStore(folderId, Buffer.from('Hello'), {
          originalName: 'test.txt',
        })

        const request = createRequest(`/api/admin/files/${file.id}`, {
          method: 'DELETE',
        })
        const context = createContext({ id: file.id })

        const response = await fileDelete(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
        expect(vault.getFileMetadata(file.id)).toBeNull()
      })

      it('should return 404 for non-existent file', async () => {
        const request = createRequest('/api/admin/files/non-existent', {
          method: 'DELETE',
        })
        const context = createContext({ id: 'non-existent' })

        const response = await fileDelete(request as any, context)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('Not Found')
      })
    })
  })

  describe('Vault not loaded', () => {
    it('should return 503 when vault is not loaded', async () => {
      // Vault is not initialized, so it's not loaded
      const request = createRequest('/api/admin/folders')

      const response = await foldersGet()
      const data = await response.json()

      expect(response.status).toBe(503)
      expect(data.error).toBe('Service Unavailable')
    })
  })
})
