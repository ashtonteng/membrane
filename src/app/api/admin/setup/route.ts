import { NextRequest } from 'next/server'
import * as vault from '@/lib/vault'
import { authenticateAdmin, unauthorizedResponse } from '@/lib/auth'

export async function POST(request: NextRequest) {
  // Authenticate (bypassed in test mode)
  if (!(await authenticateAdmin())) {
    return unauthorizedResponse()
  }

  try {
    const body = await request.json()
    const { recoveryPassword } = body

    if (!recoveryPassword || typeof recoveryPassword !== 'string') {
      return Response.json(
        { error: 'Bad Request', message: 'recoveryPassword is required' },
        { status: 400 }
      )
    }

    if (recoveryPassword.length < 8) {
      return Response.json(
        { error: 'Bad Request', message: 'recoveryPassword must be at least 8 characters' },
        { status: 400 }
      )
    }

    await vault.init(recoveryPassword)

    return Response.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('already initialized')) {
      return Response.json(
        { error: 'Conflict', message: 'Vault is already initialized' },
        { status: 409 }
      )
    }
    console.error('Setup error:', error)
    return Response.json(
      { error: 'Internal Server Error', message: 'Failed to initialize vault' },
      { status: 500 }
    )
  }
}
