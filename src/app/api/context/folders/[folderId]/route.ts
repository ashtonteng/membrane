import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, isAuthError, errorResponse, checkFolderAccess } from '@/lib/apiAuth'
import { getFolder, listFiles } from '@/lib/vault'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  // Authenticate agent
  const authResult = authenticateAgent(request)

  if (isAuthError(authResult)) {
    return errorResponse(authResult)
  }

  const agent = authResult
  const { folderId } = await params

  // Check agent has access to this folder
  const accessError = checkFolderAccess(agent.id, folderId)
  if (accessError) {
    return errorResponse(accessError)
  }

  // Get folder details
  const folder = getFolder(folderId)
  if (!folder) {
    return NextResponse.json(
      { error: 'not_found', message: 'Folder not found' },
      { status: 404 }
    )
  }

  // Get files in folder
  const files = listFiles(folderId)

  return NextResponse.json({
    folder: {
      id: folder.id,
      name: folder.name,
    },
    files: files.map((f) => ({
      id: f.id,
      name: f.original_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      created_at: f.created_at,
    })),
  })
}
