import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, isAuthError, errorResponse } from '@/lib/apiAuth'
import { getGrantedFolders } from '@/lib/db'

export async function GET(request: NextRequest) {
  // Authenticate agent
  const authResult = authenticateAgent(request)

  if (isAuthError(authResult)) {
    return errorResponse(authResult)
  }

  const agent = authResult

  // Get folders the agent has access to
  const folders = getGrantedFolders(agent.id)

  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      file_count: f.file_count,
    })),
  })
}
