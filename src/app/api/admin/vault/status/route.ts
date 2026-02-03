import * as vault from '@/lib/vault'

export async function GET() {
  // Status endpoint does not require authentication - it's used to check if setup is needed
  const initialized = vault.isInitialized()

  return Response.json({ initialized })
}
