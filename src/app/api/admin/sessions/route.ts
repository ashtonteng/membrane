import { NextRequest, NextResponse } from 'next/server'
import { createSession, deleteSession } from '@/lib/db'
import { verifyRecoveryPassword, isLoaded } from '@/lib/vault'
import { setSessionCookie, clearSessionCookie, getSessionId } from '@/lib/auth'

/**
 * POST /api/admin/sessions
 * Login with recovery password
 * Body: { recoveryPassword: string }
 * Returns: { success: true } and sets httpOnly session cookie
 */
export async function POST(request: NextRequest) {
  // Check if vault is loaded
  if (!isLoaded()) {
    return NextResponse.json(
      { error: 'vault_not_loaded', message: 'Vault is not loaded' },
      { status: 503 }
    )
  }

  try {
    const body = await request.json()
    const { recoveryPassword } = body

    if (!recoveryPassword || typeof recoveryPassword !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'recoveryPassword is required' },
        { status: 400 }
      )
    }

    // Verify recovery password
    const valid = verifyRecoveryPassword(recoveryPassword)
    if (!valid) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Invalid recovery password' },
        { status: 401 }
      )
    }

    // Create session
    const session = createSession()

    // Set session cookie
    await setSessionCookie(session.id)

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to create session' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/sessions
 * Logout (clear session)
 * Returns: { success: true }
 */
export async function DELETE() {
  // Check if vault is loaded
  if (!isLoaded()) {
    return NextResponse.json(
      { error: 'vault_not_loaded', message: 'Vault is not loaded' },
      { status: 503 }
    )
  }

  try {
    // Get current session
    const sessionId = await getSessionId()

    if (sessionId) {
      // Delete session from database
      deleteSession(sessionId)
    }

    // Clear session cookie
    await clearSessionCookie()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting session:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Failed to delete session' },
      { status: 500 }
    )
  }
}
