import { NextRequest, NextResponse } from 'next/server'
import { getAgentWithGrants, deleteAgent } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isLoaded } from '@/lib/vault'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/admin/agents/[id]
 * Get agent details with grants
 * Returns: { id, name, api_key_prefix, created_at, grants: [{ folder_id, folder_name }] }
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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
    const { id } = await params
    const agent = getAgentWithGrants(id)

    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'Agent not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(agent)
  } catch (error) {
    console.error('Error getting agent:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to get agent' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/agents/[id]
 * Delete an agent (also deletes associated grants)
 * Returns: { success: true }
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
    const { id } = await params
    const deleted = deleteAgent(id)

    if (!deleted) {
      return NextResponse.json(
        { error: 'not_found', message: 'Agent not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting agent:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to delete agent' },
      { status: 500 }
    )
  }
}
