export async function register() {
  // Only run on server (Node.js runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Dynamic import to avoid loading Node.js modules in Edge runtime
      const vault = await import('@/lib/vault')

      // Auto-load vault if already initialized
      if (vault.isInitialized()) {
        await vault.load()
        console.log('✓ Vault loaded successfully')
      } else {
        console.log('⚠ Vault not initialized - run setup first')
      }
    } catch (error) {
      console.error('✗ Failed to load vault:', error)
      // Don't crash the server - user can restore from backup via /login
    }
  }
}
