# Membrane - Local Context Vault

## Overview

Membrane is a local-first personal context vault that lets users store personal documents and data in encrypted folders on their local filesystem, then grant folder-level read access to AI agents via a localhost API.

## Architecture

```
~/.membrane/
├── vault/           # Encrypted file storage (AES-256-GCM)
├── db/              # SQLCipher-encrypted SQLite database
├── keys/            # Master key backup (PBKDF2-encrypted)
└── config.yaml      # Server configuration
```

## Tech Stack

- **Frontend/API**: Next.js 14+ (App Router), Tailwind CSS
- **Database**: SQLite with SQLCipher encryption
- **Encryption**: AES-256-GCM via Node.js crypto
- **Keychain**: keytar (cross-platform keychain access)
- **Testing**: Vitest

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── api/
│   │   ├── admin/      # Admin API (session-protected)
│   │   ├── context/    # Agent API (API key auth)
│   │   └── health/     # Health check
│   ├── vault/          # Vault manager page
│   ├── permissions/    # Permissions dashboard
│   └── agents/         # Agent registration
├── lib/
│   ├── vault.ts        # Vault encryption operations
│   ├── db.ts           # Database operations
│   ├── auth.ts         # Authentication utilities
│   └── types.ts        # TypeScript types
└── tests/              # Test files
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMBRANE_TEST_MODE` | Bypasses session auth on admin routes | `false` |
| `MEMBRANE_SKIP_KEYCHAIN` | Master key held in memory only | `false` |
| `MEMBRANE_DATA_DIR` | Override data directory | `~/.membrane` |
| `MEMBRANE_PORT` | Server port | `3000` |

## Development Commands

```bash
# Run development server
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build
```

## API Overview

### Admin API (`/api/admin/*`)
- `POST /api/admin/setup` - Initialize vault
- `GET /api/admin/vault/status` - Check vault status
- `POST/GET/PATCH/DELETE /api/admin/folders` - Folder CRUD
- `POST/GET/DELETE /api/admin/files` - File operations
- `POST/GET/DELETE /api/admin/agents` - Agent management
- `POST/GET/DELETE /api/admin/grants` - Grant management
- `POST/DELETE /api/admin/sessions` - Session management

### Agent API (`/api/context/*`)
- `GET /api/context/folders` - List granted folders
- `GET /api/context/folders/:id` - List files in folder
- `GET /api/context/files/:id` - Get decrypted file content

## Security Model

- All vault files encrypted at rest with AES-256-GCM
- SQLite database encrypted with SQLCipher
- Master key stored in system keychain
- API key authentication for agents
- Session-based authentication for GUI
