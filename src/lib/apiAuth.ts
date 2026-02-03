import { NextRequest, NextResponse } from 'next/server'
import { getAgentByApiKey, hasGrant } from './db'
import type { Agent } from './types'

export interface AuthenticatedRequest {
  agent: Agent
}

export interface AuthError {
  error: string
  message: string
  status: number
}

// Extract bearer token from Authorization header
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null
  }

  return parts[1]
}

// Authenticate request by API key
export function authenticateAgent(request: NextRequest): Agent | AuthError {
  const authHeader = request.headers.get('authorization')
  const token = extractBearerToken(authHeader)

  if (!token) {
    return {
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer mb_sk_...',
      status: 401,
    }
  }

  // Validate token format
  if (!token.startsWith('mb_sk_')) {
    return {
      error: 'unauthorized',
      message: 'Invalid API key format. Expected: mb_sk_...',
      status: 401,
    }
  }

  // Look up agent by API key hash
  const agent = getAgentByApiKey(token)

  if (!agent) {
    return {
      error: 'unauthorized',
      message: 'Invalid API key',
      status: 401,
    }
  }

  return agent
}

// Check if result is an error
export function isAuthError(result: Agent | AuthError): result is AuthError {
  return 'error' in result && 'status' in result
}

// Check if agent has grant for folder
export function checkFolderAccess(agentId: string, folderId: string): AuthError | null {
  if (!hasGrant(agentId, folderId)) {
    return {
      error: 'no_access',
      message: 'This agent has not been granted access to this folder. Contact the vault owner to request access.',
      status: 403,
    }
  }
  return null
}

// Create error response
export function errorResponse(error: AuthError): NextResponse {
  return NextResponse.json(
    { error: error.error, message: error.message },
    { status: error.status }
  )
}
