import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as vault from '../lib/vault'
import * as db from '../lib/db'

describe('Database Operations', () => {
  let testDataDir: string

  beforeEach(async () => {
    // Create unique test directory for each test
    testDataDir = join(tmpdir(), `membrane-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

  describe('Agent operations', () => {
    it('should create an agent with API key', () => {
      const agent = db.createAgent('Test Agent')

      expect(agent.id).toBeDefined()
      expect(agent.name).toBe('Test Agent')
      expect(agent.api_key).toMatch(/^mb_sk_/)
      expect(agent.api_key_prefix).toBe(agent.api_key.substring(0, 12))
    })

    it('should find agent by API key', () => {
      const created = db.createAgent('Test Agent')

      const found = db.getAgentByApiKey(created.api_key)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.name).toBe('Test Agent')
    })

    it('should return null for invalid API key', () => {
      db.createAgent('Test Agent')

      const found = db.getAgentByApiKey('mb_sk_invalid')

      expect(found).toBeNull()
    })

    it('should get agent by id', () => {
      const created = db.createAgent('Test Agent')

      const found = db.getAgentById(created.id)

      expect(found).not.toBeNull()
      expect(found!.name).toBe('Test Agent')
      // Should NOT include api_key or api_key_hash
      expect((found as Record<string, unknown>).api_key).toBeUndefined()
      expect((found as Record<string, unknown>).api_key_hash).toBeUndefined()
    })

    it('should list all agents', () => {
      db.createAgent('Agent 1')
      db.createAgent('Agent 2')

      const agents = db.listAgents()

      expect(agents.length).toBe(2)
      expect(agents.map((a) => a.name)).toContain('Agent 1')
      expect(agents.map((a) => a.name)).toContain('Agent 2')
    })

    it('should delete agent', () => {
      const agent = db.createAgent('Test Agent')

      const deleted = db.deleteAgent(agent.id)

      expect(deleted).toBe(true)
      expect(db.getAgentById(agent.id)).toBeNull()
    })

    it('should return false when deleting non-existent agent', () => {
      const deleted = db.deleteAgent('non-existent-id')

      expect(deleted).toBe(false)
    })
  })

  describe('Grant operations', () => {
    let agentId: string
    let apiKey: string
    let folderId: string

    beforeEach(() => {
      const agent = db.createAgent('Test Agent')
      agentId = agent.id
      apiKey = agent.api_key
      const folder = vault.createFolder('Test Folder')
      folderId = folder.id
    })

    it('should create a grant', () => {
      const grant = db.createGrant(agentId, folderId)

      expect(grant.id).toBeDefined()
      expect(grant.agent_id).toBe(agentId)
      expect(grant.folder_id).toBe(folderId)
      expect(grant.granted_at).toBeDefined()
    })

    it('should throw if agent does not exist', () => {
      expect(() => db.createGrant('non-existent', folderId)).toThrow('Agent not found')
    })

    it('should throw if folder does not exist', () => {
      expect(() => db.createGrant(agentId, 'non-existent')).toThrow('Folder not found')
    })

    it('should throw if grant already exists', () => {
      db.createGrant(agentId, folderId)

      expect(() => db.createGrant(agentId, folderId)).toThrow('Grant already exists')
    })

    it('should check if agent has grant', () => {
      expect(db.hasGrant(agentId, folderId)).toBe(false)

      db.createGrant(agentId, folderId)

      expect(db.hasGrant(agentId, folderId)).toBe(true)
    })

    it('should list grants with names', () => {
      db.createGrant(agentId, folderId)

      const grants = db.listGrants()

      expect(grants.length).toBe(1)
      expect(grants[0].agent_name).toBe('Test Agent')
      expect(grants[0].folder_name).toBe('Test Folder')
    })

    it('should filter grants by agentId', () => {
      const agent2 = db.createAgent('Agent 2')
      db.createGrant(agentId, folderId)
      db.createGrant(agent2.id, folderId)

      const grants = db.listGrants({ agentId })

      expect(grants.length).toBe(1)
      expect(grants[0].agent_id).toBe(agentId)
    })

    it('should filter grants by folderId', () => {
      const folder2 = vault.createFolder('Folder 2')
      db.createGrant(agentId, folderId)
      db.createGrant(agentId, folder2.id)

      const grants = db.listGrants({ folderId })

      expect(grants.length).toBe(1)
      expect(grants[0].folder_id).toBe(folderId)
    })

    it('should delete grant', () => {
      const grant = db.createGrant(agentId, folderId)

      const deleted = db.deleteGrant(grant.id)

      expect(deleted).toBe(true)
      expect(db.hasGrant(agentId, folderId)).toBe(false)
    })

    it('should get granted folders for agent', () => {
      db.createGrant(agentId, folderId)

      const folders = db.getGrantedFolders(agentId)

      expect(folders.length).toBe(1)
      expect(folders[0].id).toBe(folderId)
      expect(folders[0].name).toBe('Test Folder')
    })

    it('should get agent with grants', () => {
      db.createGrant(agentId, folderId)

      const agent = db.getAgentWithGrants(agentId)

      expect(agent).not.toBeNull()
      expect(agent!.grants.length).toBe(1)
      expect(agent!.grants[0].folder_id).toBe(folderId)
      expect(agent!.grants[0].folder_name).toBe('Test Folder')
    })

    it('should cascade delete grants when agent is deleted', () => {
      db.createGrant(agentId, folderId)
      expect(db.hasGrant(agentId, folderId)).toBe(true)

      db.deleteAgent(agentId)

      // Grant should be gone
      const grants = db.listGrants()
      expect(grants.length).toBe(0)
    })

    it('should cascade delete grants when folder is deleted', () => {
      db.createGrant(agentId, folderId)
      expect(db.hasGrant(agentId, folderId)).toBe(true)

      vault.deleteFolder(folderId)

      // Grant should be gone
      const grants = db.listGrants()
      expect(grants.length).toBe(0)
    })
  })

  describe('Session operations', () => {
    it('should create a session', () => {
      const session = db.createSession()

      expect(session.id).toBeDefined()
      expect(session.id.length).toBe(64) // 32 bytes hex
      expect(session.created_at).toBeDefined()
    })

    it('should get session by id', () => {
      const created = db.createSession()

      const found = db.getSession(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
    })

    it('should return null for non-existent session', () => {
      const found = db.getSession('non-existent')

      expect(found).toBeNull()
    })

    it('should validate existing session', () => {
      const session = db.createSession()

      expect(db.validateSession(session.id)).toBe(true)
    })

    it('should not validate non-existent session', () => {
      expect(db.validateSession('non-existent')).toBe(false)
    })

    it('should delete session', () => {
      const session = db.createSession()

      const deleted = db.deleteSession(session.id)

      expect(deleted).toBe(true)
      expect(db.getSession(session.id)).toBeNull()
    })
  })
})
