import { createHash, randomBytes } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './vault'
import type { Agent, AgentPublic, AgentWithKey, AgentWithGrants, Grant, GrantWithNames, Session } from './types'

// Generate API key
function generateApiKey(): string {
  const randomPart = randomBytes(24).toString('base64url')
  return `mb_sk_${randomPart}`
}

// Hash API key with SHA-256
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

// Get API key prefix (first 12 chars for display)
function getApiKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 12)
}

// Agent operations
export function createAgent(name: string): AgentWithKey {
  const db = getDb()
  const id = uuidv4()
  const apiKey = generateApiKey()
  const apiKeyHash = hashApiKey(apiKey)
  const apiKeyPrefix = getApiKeyPrefix(apiKey)

  const stmt = db.prepare(`
    INSERT INTO agents (id, name, api_key_hash, api_key_prefix)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(id, name, apiKeyHash, apiKeyPrefix)

  return {
    id,
    name,
    api_key_prefix: apiKeyPrefix,
    api_key: apiKey,
    created_at: new Date().toISOString(),
  }
}

export function getAgentByApiKey(apiKey: string): Agent | null {
  const db = getDb()
  const apiKeyHash = hashApiKey(apiKey)

  const agent = db.prepare(`
    SELECT * FROM agents WHERE api_key_hash = ?
  `).get(apiKeyHash) as Agent | undefined

  return agent || null
}

export function getAgentById(agentId: string): AgentPublic | null {
  const db = getDb()

  const agent = db.prepare(`
    SELECT id, name, api_key_prefix, created_at FROM agents WHERE id = ?
  `).get(agentId) as AgentPublic | undefined

  return agent || null
}

export function getAgentWithGrants(agentId: string): AgentWithGrants | null {
  const db = getDb()

  const agent = db.prepare(`
    SELECT id, name, api_key_prefix, created_at FROM agents WHERE id = ?
  `).get(agentId) as AgentPublic | undefined

  if (!agent) {
    return null
  }

  const grants = db.prepare(`
    SELECT g.folder_id, f.name as folder_name
    FROM grants g
    JOIN folders f ON f.id = g.folder_id
    WHERE g.agent_id = ?
  `).all(agentId) as Array<{ folder_id: string; folder_name: string }>

  return {
    ...agent,
    grants,
  }
}

export function listAgents(): AgentPublic[] {
  const db = getDb()

  const agents = db.prepare(`
    SELECT id, name, api_key_prefix, created_at FROM agents ORDER BY created_at DESC
  `).all() as AgentPublic[]

  return agents
}

export function deleteAgent(agentId: string): boolean {
  const db = getDb()

  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
  return result.changes > 0
}

// Grant operations
export function createGrant(agentId: string, folderId: string): Grant {
  const db = getDb()
  const id = uuidv4()

  // Check agent exists
  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)
  if (!agent) {
    throw new Error('Agent not found')
  }

  // Check folder exists
  const folder = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId)
  if (!folder) {
    throw new Error('Folder not found')
  }

  // Check if grant already exists
  const existingGrant = db.prepare(`
    SELECT id FROM grants WHERE agent_id = ? AND folder_id = ?
  `).get(agentId, folderId)
  if (existingGrant) {
    throw new Error('Grant already exists')
  }

  const stmt = db.prepare(`
    INSERT INTO grants (id, agent_id, folder_id)
    VALUES (?, ?, ?)
  `)
  stmt.run(id, agentId, folderId)

  const grant = db.prepare('SELECT * FROM grants WHERE id = ?').get(id) as Grant
  return grant
}

export function getGrantById(grantId: string): Grant | null {
  const db = getDb()

  const grant = db.prepare('SELECT * FROM grants WHERE id = ?').get(grantId) as Grant | undefined
  return grant || null
}

export function listGrants(filters?: { agentId?: string; folderId?: string }): GrantWithNames[] {
  const db = getDb()

  let query = `
    SELECT g.*, a.name as agent_name, f.name as folder_name
    FROM grants g
    JOIN agents a ON a.id = g.agent_id
    JOIN folders f ON f.id = g.folder_id
  `
  const params: string[] = []

  if (filters?.agentId || filters?.folderId) {
    const conditions: string[] = []
    if (filters.agentId) {
      conditions.push('g.agent_id = ?')
      params.push(filters.agentId)
    }
    if (filters.folderId) {
      conditions.push('g.folder_id = ?')
      params.push(filters.folderId)
    }
    query += ` WHERE ${conditions.join(' AND ')}`
  }

  query += ' ORDER BY g.granted_at DESC'

  const grants = db.prepare(query).all(...params) as GrantWithNames[]
  return grants
}

export function deleteGrant(grantId: string): boolean {
  const db = getDb()

  const result = db.prepare('DELETE FROM grants WHERE id = ?').run(grantId)
  return result.changes > 0
}

export function hasGrant(agentId: string, folderId: string): boolean {
  const db = getDb()

  const grant = db.prepare(`
    SELECT id FROM grants WHERE agent_id = ? AND folder_id = ?
  `).get(agentId, folderId)

  return !!grant
}

export function getGrantedFolders(agentId: string): Array<{ id: string; name: string; file_count: number }> {
  const db = getDb()

  const folders = db.prepare(`
    SELECT f.id, f.name, COUNT(files.id) as file_count
    FROM grants g
    JOIN folders f ON f.id = g.folder_id
    LEFT JOIN files ON files.folder_id = f.id
    WHERE g.agent_id = ?
    GROUP BY f.id
    ORDER BY f.name
  `).all(agentId) as Array<{ id: string; name: string; file_count: number }>

  return folders
}

// Session operations
export function createSession(): Session {
  const db = getDb()
  const id = randomBytes(32).toString('hex')

  const stmt = db.prepare(`
    INSERT INTO sessions (id)
    VALUES (?)
  `)
  stmt.run(id)

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session
  return session
}

export function getSession(sessionId: string): Session | null {
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session | undefined
  return session || null
}

export function deleteSession(sessionId: string): boolean {
  const db = getDb()

  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  return result.changes > 0
}

export function validateSession(sessionId: string): boolean {
  return getSession(sessionId) !== null
}
