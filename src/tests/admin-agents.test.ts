import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { NextRequest } from 'next/server'
import * as vault from '../lib/vault'
import * as db from '../lib/db'

// Mock next/headers for cookie handling
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}))

// Import routes after mocking
import { POST as createAgent, GET as listAgents } from '../app/api/admin/agents/route'
import { GET as getAgent, DELETE as deleteAgentRoute } from '../app/api/admin/agents/[id]/route'
import { POST as createGrant, GET as listGrants } from '../app/api/admin/grants/route'
import { DELETE as deleteGrantRoute } from '../app/api/admin/grants/[id]/route'
import { POST as login, DELETE as logout } from '../app/api/admin/sessions/route'

describe('Admin API', () => {
  let testDataDir: string

  beforeEach(async () => {
    // Create unique test directory for each test
    testDataDir = join(tmpdir(), `membrane-admin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  describe('Agents API', () => {
    describe('POST /api/admin/agents', () => {
      it('should create an agent', async () => {
        const request = new NextRequest('http://localhost/api/admin/agents', {
          method: 'POST',
          body: JSON.stringify({ name: 'Test Agent' }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createAgent(request)
        const data = await response.json()

        expect(response.status).toBe(201)
        expect(data.id).toBeDefined()
        expect(data.name).toBe('Test Agent')
        expect(data.api_key).toMatch(/^mb_sk_/)
        expect(data.api_key_prefix).toBeDefined()
        expect(data.created_at).toBeDefined()
      })

      it('should return 400 if name is missing', async () => {
        const request = new NextRequest('http://localhost/api/admin/agents', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createAgent(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('invalid_request')
      })

      it('should return 400 if name is empty', async () => {
        const request = new NextRequest('http://localhost/api/admin/agents', {
          method: 'POST',
          body: JSON.stringify({ name: '   ' }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createAgent(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('invalid_request')
      })
    })

    describe('GET /api/admin/agents', () => {
      it('should list agents', async () => {
        // Create some agents directly
        db.createAgent('Agent 1')
        db.createAgent('Agent 2')

        const request = new NextRequest('http://localhost/api/admin/agents', {
          method: 'GET',
        })

        const response = await listAgents()
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.agents).toHaveLength(2)
        expect(data.agents[0].api_key).toBeUndefined() // api_key not exposed in list
        expect(data.agents.map((a: { name: string }) => a.name)).toContain('Agent 1')
        expect(data.agents.map((a: { name: string }) => a.name)).toContain('Agent 2')
      })

      it('should return empty list when no agents', async () => {
        const response = await listAgents()
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.agents).toHaveLength(0)
      })
    })

    describe('GET /api/admin/agents/[id]', () => {
      it('should get agent with grants', async () => {
        const agent = db.createAgent('Test Agent')
        const folder = vault.createFolder('Test Folder')
        db.createGrant(agent.id, folder.id)

        const request = new NextRequest(`http://localhost/api/admin/agents/${agent.id}`, {
          method: 'GET',
        })

        const response = await getAgent(request, { params: Promise.resolve({ id: agent.id }) })
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.id).toBe(agent.id)
        expect(data.name).toBe('Test Agent')
        expect(data.grants).toHaveLength(1)
        expect(data.grants[0].folder_id).toBe(folder.id)
        expect(data.grants[0].folder_name).toBe('Test Folder')
      })

      it('should return 404 for non-existent agent', async () => {
        const request = new NextRequest('http://localhost/api/admin/agents/non-existent', {
          method: 'GET',
        })

        const response = await getAgent(request, { params: Promise.resolve({ id: 'non-existent' }) })
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('not_found')
      })
    })

    describe('DELETE /api/admin/agents/[id]', () => {
      it('should delete agent', async () => {
        const agent = db.createAgent('Test Agent')

        const request = new NextRequest(`http://localhost/api/admin/agents/${agent.id}`, {
          method: 'DELETE',
        })

        const response = await deleteAgentRoute(request, { params: Promise.resolve({ id: agent.id }) })
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)

        // Verify agent is deleted
        expect(db.getAgentById(agent.id)).toBeNull()
      })

      it('should return 404 for non-existent agent', async () => {
        const request = new NextRequest('http://localhost/api/admin/agents/non-existent', {
          method: 'DELETE',
        })

        const response = await deleteAgentRoute(request, { params: Promise.resolve({ id: 'non-existent' }) })
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('not_found')
      })
    })
  })

  describe('Grants API', () => {
    let agentId: string
    let folderId: string

    beforeEach(() => {
      const agent = db.createAgent('Test Agent')
      agentId = agent.id
      const folder = vault.createFolder('Test Folder')
      folderId = folder.id
    })

    describe('POST /api/admin/grants', () => {
      it('should create a grant', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ agentId, folderId }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(201)
        expect(data.id).toBeDefined()
        expect(data.agent_id).toBe(agentId)
        expect(data.folder_id).toBe(folderId)
        expect(data.granted_at).toBeDefined()
      })

      it('should return 400 if agentId is missing', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ folderId }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('invalid_request')
      })

      it('should return 400 if folderId is missing', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ agentId }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('invalid_request')
      })

      it('should return 404 if agent does not exist', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ agentId: 'non-existent', folderId }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('not_found')
        expect(data.message).toBe('Agent not found')
      })

      it('should return 404 if folder does not exist', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ agentId, folderId: 'non-existent' }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('not_found')
        expect(data.message).toBe('Folder not found')
      })

      it('should return 409 if grant already exists', async () => {
        // Create grant first
        db.createGrant(agentId, folderId)

        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'POST',
          body: JSON.stringify({ agentId, folderId }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await createGrant(request)
        const data = await response.json()

        expect(response.status).toBe(409)
        expect(data.error).toBe('conflict')
      })
    })

    describe('GET /api/admin/grants', () => {
      it('should list all grants', async () => {
        db.createGrant(agentId, folderId)

        const request = new NextRequest('http://localhost/api/admin/grants', {
          method: 'GET',
        })

        const response = await listGrants(request)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.grants).toHaveLength(1)
        expect(data.grants[0].agent_id).toBe(agentId)
        expect(data.grants[0].folder_id).toBe(folderId)
        expect(data.grants[0].agent_name).toBe('Test Agent')
        expect(data.grants[0].folder_name).toBe('Test Folder')
      })

      it('should filter grants by agentId', async () => {
        const agent2 = db.createAgent('Agent 2')
        db.createGrant(agentId, folderId)
        db.createGrant(agent2.id, folderId)

        const request = new NextRequest(`http://localhost/api/admin/grants?agentId=${agentId}`, {
          method: 'GET',
        })

        const response = await listGrants(request)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.grants).toHaveLength(1)
        expect(data.grants[0].agent_id).toBe(agentId)
      })

      it('should filter grants by folderId', async () => {
        const folder2 = vault.createFolder('Folder 2')
        db.createGrant(agentId, folderId)
        db.createGrant(agentId, folder2.id)

        const request = new NextRequest(`http://localhost/api/admin/grants?folderId=${folderId}`, {
          method: 'GET',
        })

        const response = await listGrants(request)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.grants).toHaveLength(1)
        expect(data.grants[0].folder_id).toBe(folderId)
      })
    })

    describe('DELETE /api/admin/grants/[id]', () => {
      it('should delete a grant', async () => {
        const grant = db.createGrant(agentId, folderId)

        const request = new NextRequest(`http://localhost/api/admin/grants/${grant.id}`, {
          method: 'DELETE',
        })

        const response = await deleteGrantRoute(request, { params: Promise.resolve({ id: grant.id }) })
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)

        // Verify grant is deleted
        expect(db.hasGrant(agentId, folderId)).toBe(false)
      })

      it('should return 404 for non-existent grant', async () => {
        const request = new NextRequest('http://localhost/api/admin/grants/non-existent', {
          method: 'DELETE',
        })

        const response = await deleteGrantRoute(request, { params: Promise.resolve({ id: 'non-existent' }) })
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toBe('not_found')
      })
    })
  })

  describe('Sessions API', () => {
    describe('POST /api/admin/sessions (login)', () => {
      it('should login with correct recovery password', async () => {
        const request = new NextRequest('http://localhost/api/admin/sessions', {
          method: 'POST',
          body: JSON.stringify({ recoveryPassword: 'test-password' }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await login(request)
        const data = await response.json()

        expect(response.status).toBe(201)
        expect(data.success).toBe(true)
      })

      it('should return 401 with incorrect password', async () => {
        const request = new NextRequest('http://localhost/api/admin/sessions', {
          method: 'POST',
          body: JSON.stringify({ recoveryPassword: 'wrong-password' }),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await login(request)
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data.error).toBe('unauthorized')
      })

      it('should return 400 if password is missing', async () => {
        const request = new NextRequest('http://localhost/api/admin/sessions', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await login(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe('invalid_request')
      })
    })

    describe('DELETE /api/admin/sessions (logout)', () => {
      it('should logout successfully', async () => {
        const response = await logout()
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
      })
    })
  })

  describe('Auth middleware', () => {
    it('should bypass auth in test mode', async () => {
      // Test mode is enabled, so auth should be bypassed
      const request = new NextRequest('http://localhost/api/admin/agents', {
        method: 'GET',
      })

      const response = await listAgents()

      expect(response.status).toBe(200)
    })

    it('should require auth when test mode is disabled', async () => {
      // Temporarily disable test mode
      const originalTestMode = process.env.MEMBRANE_TEST_MODE
      process.env.MEMBRANE_TEST_MODE = 'false'

      try {
        const response = await listAgents()
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data.error).toBe('unauthorized')
      } finally {
        process.env.MEMBRANE_TEST_MODE = originalTestMode
      }
    })
  })
})
