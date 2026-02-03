import { NextRequest } from 'next/server'
import * as vault from '@/lib/vault'
import { authenticateAdmin, unauthorizedResponse } from '@/lib/auth'

type RouteContext = {
  params: Promise<{ folderId: string }>
}

export async function POST(
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
    const { folderId } = await context.params

    // Check folder exists
    const folder = vault.getFolder(folderId)
    if (!folder) {
      return Response.json(
        { error: 'Not Found', message: 'Folder not found' },
        { status: 404 }
      )
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json(
        { error: 'Bad Request', message: 'file is required' },
        { status: 400 }
      )
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Encrypt and store file
    const metadata = vault.encryptAndStore(folderId, buffer, {
      originalName: file.name,
      mimeType: file.type || undefined,
    })

    return Response.json({
      id: metadata.id,
      folder_id: metadata.folder_id,
      original_name: metadata.original_name,
      mime_type: metadata.mime_type,
      size_bytes: metadata.size_bytes,
      created_at: metadata.created_at,
    }, { status: 201 })
  } catch (error) {
    console.error('Upload file error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to upload file' },
      { status: 500 }
    )
  }
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
    const { folderId } = await context.params

    // Check folder exists
    const folder = vault.getFolder(folderId)
    if (!folder) {
      return Response.json(
        { error: 'Not Found', message: 'Folder not found' },
        { status: 404 }
      )
    }

    const files = vault.listFiles(folderId)

    return Response.json({ files })
  } catch (error) {
    console.error('List files error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to list files' },
      { status: 500 }
    )
  }
}
