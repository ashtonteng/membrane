import { NextRequest } from 'next/server'
import * as vault from '@/lib/vault'
import { authenticateAdmin, unauthorizedResponse } from '@/lib/auth'

export async function POST(request: NextRequest) {
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

    const folder = vault.createFolder(name.trim())

    return Response.json({
      id: folder.id,
      name: folder.name,
      created_at: folder.created_at,
    }, { status: 201 })
  } catch (error) {
    console.error('Create folder error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to create folder' },
      { status: 500 }
    )
  }
}

export async function GET() {
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
    const folders = vault.listFolders()

    return Response.json({ folders })
  } catch (error) {
    console.error('List folders error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to list folders' },
      { status: 500 }
    )
  }
}
