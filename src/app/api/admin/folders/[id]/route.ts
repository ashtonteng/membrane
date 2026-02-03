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
    const folder = vault.getFolder(id)

    if (!folder) {
      return Response.json(
        { error: 'Not Found', message: 'Folder not found' },
        { status: 404 }
      )
    }

    return Response.json({
      id: folder.id,
      name: folder.name,
      file_count: folder.file_count,
      created_at: folder.created_at,
      updated_at: folder.updated_at,
    })
  } catch (error) {
    console.error('Get folder error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to get folder' },
      { status: 500 }
    )
  }
}

export async function PATCH(
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
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string') {
      return Response.json(
        { error: 'Bad Request', message: 'name is required' },
        { status: 400 }
      )
    }

    if (name.trim().length === 0) {
      return Response.json(
        { error: 'Bad Request', message: 'name cannot be empty' },
        { status: 400 }
      )
    }

    const folder = vault.renameFolder(id, name.trim())

    return Response.json({
      id: folder.id,
      name: folder.name,
      updated_at: folder.updated_at,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return Response.json(
        { error: 'Not Found', message: 'Folder not found' },
        { status: 404 }
      )
    }
    console.error('Rename folder error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to rename folder' },
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
    vault.deleteFolder(id)

    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return Response.json(
        { error: 'Not Found', message: 'Folder not found' },
        { status: 404 }
      )
    }
    console.error('Delete folder error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to delete folder' },
      { status: 500 }
    )
  }
}
