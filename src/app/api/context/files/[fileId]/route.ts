import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, isAuthError, errorResponse, checkFolderAccess } from '@/lib/apiAuth'
import { decryptAndRead, getFileMetadata } from '@/lib/vault'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  // Authenticate agent
  const authResult = authenticateAgent(request)

  if (isAuthError(authResult)) {
    return errorResponse(authResult)
  }

  const agent = authResult
  const { fileId } = await params

  // Get file metadata first to check folder access
  const metadata = getFileMetadata(fileId)
  if (!metadata) {
    return NextResponse.json(
      { error: 'not_found', message: 'File not found' },
      { status: 404 }
    )
  }

  // Check agent has access to this file's folder
  const accessError = checkFolderAccess(agent.id, metadata.folder_id)
  if (accessError) {
    return errorResponse(accessError)
  }

  // Decrypt and read file
  try {
    const { buffer, metadata: fileMetadata } = decryptAndRead(fileId)

    // Return file content with headers
    const response = new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': fileMetadata.mime_type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(fileMetadata.original_name),
        'X-File-Size': String(fileMetadata.size_bytes),
      },
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to read file' },
      { status: 500 }
    )
  }
}
