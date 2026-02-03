import { NextRequest } from 'next/server'
import * as vault from '@/lib/vault'
import { authenticateAdmin, unauthorizedResponse } from '@/lib/auth'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  // Authenticate (bypassed in test mode)
  if (!(await authenticateAdmin())) {
    return unauthorizedResponse()
  }

  // Check vault is loaded
  if (!vault.isLoaded()) {
    return Response.json(
      { error: 'Service Unavailable', message: 'Vault is not loaded' },
      { status: 503 }
    )
  }

  try {
    const { id } = await context.params
    const metadata = vault.getFileMetadata(id)

    if (!metadata) {
      return Response.json(
        { error: 'Not Found', message: 'File not found' },
        { status: 404 }
      )
    }

    return Response.json({
      id: metadata.id,
      folder_id: metadata.folder_id,
      original_name: metadata.original_name,
      mime_type: metadata.mime_type,
      size_bytes: metadata.size_bytes,
      created_at: metadata.created_at,
      updated_at: metadata.updated_at,
    })
  } catch (error) {
    console.error('Get file metadata error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to get file metadata' },
      { status: 500 }
    )
  }
}
