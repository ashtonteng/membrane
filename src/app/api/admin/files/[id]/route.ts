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

    const { buffer, metadata } = vault.decryptAndRead(id)

    // Return file content with appropriate headers
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': metadata.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.original_name)}"`,
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return Response.json(
        { error: 'Not Found', message: 'File not found' },
        { status: 404 }
      )
    }
    console.error('Get file error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to get file' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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
    vault.deleteFile(id)

    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return Response.json(
        { error: 'Not Found', message: 'File not found' },
        { status: 404 }
      )
    }
    console.error('Delete file error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to delete file' },
      { status: 500 }
    )
  }
}
