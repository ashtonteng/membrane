import { cookies } from 'next/headers'
import { validateSession } from './db'

// Check if running in test mode
export function isTestMode(): boolean {
  return process.env.MEMBRANE_TEST_MODE === 'true'
}

// Authenticate admin request - returns true if authenticated
export async function authenticateAdmin(): Promise<boolean> {
  // In test mode, bypass authentication
  if (isTestMode()) {
    return true
  }

  // Check for session cookie
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('membrane_session')?.value

  if (!sessionId) {
    return false
  }

  return validateSession(sessionId)
}

// Helper to create error response
export function unauthorizedResponse() {
  return Response.json(
    { error: 'Unauthorized', message: 'Authentication required' },
    { status: 401 }
  )
}
