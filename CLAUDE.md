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

## Implementation Status

- [x] Phase 1: Vault + Encryption Layer (54 tests)
- [x] Phase 2: Admin API - Setup, Folders, Files (29 tests)
- [x] Phase 3: Admin API - Agents, Grants, Sessions (26 tests)
- [x] Phase 4: Agent API - Context Endpoints (24 tests)
- [ ] Phase 5: Web GUI

**Total: 133 tests passing**

## Project Structure

```
src/
├── app/                 # Next.js App Router
│   └── api/
│       ├── admin/       # Admin API (session-protected)
│       │   ├── setup/   # POST - Initialize vault
│       │   ├── vault/   # GET status
│       │   ├── folders/ # CRUD operations
│       │   ├── files/   # File operations
│       │   ├── agents/  # Agent management
│       │   ├── grants/  # Grant management
│       │   └── sessions/# Session auth
│       ├── context/     # Agent API (API key auth)
│       │   ├── folders/ # List granted folders/files
│       │   └── files/   # Get decrypted content
│       └── health/      # Health check
├── lib/
│   ├── vault.ts         # Vault encryption operations
│   ├── db.ts            # Database operations (agents, grants, sessions)
│   ├── auth.ts          # Session authentication
│   ├── apiAuth.ts       # API key authentication for agents
│   └── types.ts         # TypeScript types
└── tests/
    ├── vault.test.ts    # Vault layer tests
    ├── db.test.ts       # Database tests
    ├── admin-api.test.ts # Admin API tests
    ├── admin-agents.test.ts # Agents/grants tests
    └── context-api.test.ts # Agent API tests
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
