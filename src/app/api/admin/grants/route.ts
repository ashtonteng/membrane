import { NextRequest, NextResponse } from 'next/server'
import { createGrant, listGrants } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isLoaded } from '@/lib/vault'

/**
 * POST /api/admin/grants
 * Create a new grant (give agent access to folder)
 * Body: { agentId: string, folderId: string }
 * Returns: { id, agent_id, folder_id, granted_at }
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
    const { agentId, folderId } = body

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'agentId is required' },
        { status: 400 }
      )
    }

    if (!folderId || typeof folderId !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'folderId is required' },
        { status: 400 }
      )
    }

    const grant = createGrant(agentId, folderId)

    return NextResponse.json(grant, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'Agent not found') {
      return NextResponse.json(
        { error: 'not_found', message: 'Agent not found' },
        { status: 404 }
      )
    }

    if (message === 'Folder not found') {
      return NextResponse.json(
        { error: 'not_found', message: 'Folder not found' },
        { status: 404 }
      )
    }

    if (message === 'Grant already exists') {
      return NextResponse.json(
        { error: 'conflict', message: 'Grant already exists for this agent and folder' },
        { status: 409 }
      )
    }

    console.error('Error creating grant:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to create grant' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/grants
 * List grants (optionally filtered by agentId or folderId)
 * Query params: ?agentId=xxx or ?folderId=xxx
 * Returns: { grants: [{ id, agent_id, folder_id, granted_at, agent_name, folder_name }] }
 */
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || undefined
    const folderId = searchParams.get('folderId') || undefined

    const filters = agentId || folderId ? { agentId, folderId } : undefined
    const grants = listGrants(filters)

    return NextResponse.json({ grants })
  } catch (error) {
    console.error('Error listing grants:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to list grants' },
      { status: 500 }
    )
  }
}
