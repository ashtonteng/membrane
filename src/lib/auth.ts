import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { validateSession } from './db'

const SESSION_COOKIE_NAME = 'membrane_session'

/**
 * Check if test mode is enabled (bypasses session auth)
 */
export function isTestMode(): boolean {
  return process.env.MEMBRANE_TEST_MODE === 'true'
}

/**
 * Get the session ID from cookies
 */
export async function getSessionId(): Promise<string | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
  return sessionCookie?.value || null
}

/**
 * Validate the current session from cookies
 * Returns true if session is valid or if in test mode
 */
export async function isAuthenticated(): Promise<boolean> {
  // In test mode, bypass session auth
  if (isTestMode()) {
    return true
  }

  const sessionId = await getSessionId()
  if (!sessionId) {
    return false
  }

  return validateSession(sessionId)
}

/**
 * Middleware function to require authentication
 * Returns an error response if not authenticated, null otherwise
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const authenticated = await isAuthenticated()

  if (!authenticated) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Authentication required' },
      { status: 401 }
    )
  }

  return null
}

/**
 * Set session cookie
 */
export async function setSessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // Session cookie - no maxAge means it expires when browser closes
    // For longer sessions, could add: maxAge: 60 * 60 * 24 * 7 (7 days)
  })
}

/**
 * Clear session cookie
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export { SESSION_COOKIE_NAME }
