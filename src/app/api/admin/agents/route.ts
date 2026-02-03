import { NextRequest, NextResponse } from 'next/server'
import { createAgent, listAgents } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isLoaded } from '@/lib/vault'

/**
 * POST /api/admin/agents
 * Register a new agent
 * Body: { name: string }
 * Returns: { id, name, api_key, api_key_prefix, created_at }
 * Note: api_key is shown ONCE and cannot be retrieved again
 */
export async function POST(request: NextRequest) {
  // Check authentication
  const authError = await requireAuth()
  if (authError) return authError

  // Check if vault is loaded
  if (!isLoaded()) {
    return NextResponse.json(
      { error: 'vault_not_loaded', message: 'Vault is not loaded' },
      { status: 503 }
    )
  }

  try {
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Name is required' },
        { status: 400 }
      )
    }

    const agent = createAgent(name.trim())

    return NextResponse.json(agent, { status: 201 })
  } catch (error) {
    console.error('Error creating agent:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to create agent' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/agents
 * List all agents
 * Returns: { agents: [{ id, name, api_key_prefix, created_at }] }
 */
export async function GET() {
  // Check authentication
  const authError = await requireAuth()
  if (authError) return authError

  // Check if vault is loaded
  if (!isLoaded()) {
    return NextResponse.json(
      { error: 'vault_not_loaded', message: 'Vault is not loaded' },
      { status: 503 }
    )
  }

  try {
    const agents = listAgents()

    return NextResponse.json({ agents })
  } catch (error) {
    console.error('Error listing agents:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to list agents' },
      { status: 500 }
    )
  }
}
