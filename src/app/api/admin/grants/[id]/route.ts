import { NextRequest, NextResponse } from 'next/server'
import { deleteGrant, getGrantById } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isLoaded } from '@/lib/vault'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/admin/grants/[id]
 * Revoke a grant
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
    const deleted = deleteGrant(id)

    if (!deleted) {
      return NextResponse.json(
        { error: 'not_found', message: 'Grant not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting grant:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to delete grant' },
      { status: 500 }
    )
  }
}
