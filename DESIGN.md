# Membrane — Local V0 Implementation Prompt

## What You Are Building

You are building a local-first personal context vault called **Membrane**. It is a system that lets a user store personal documents and data in encrypted folders on their local filesystem, then grant folder-level read access to AI agents via a localhost API. Membrane is a selectively permeable barrier between your personal context and the AI agents you use — you control exactly what passes through.

The system has three parts:

1. **An encrypted local vault** — a directory structure on disk where user files live, encrypted at rest
2. **A localhost web GUI** (Next.js on `localhost:3000`) — where the user manages folders, uploads files, and controls which agents can access which folders
3. **A localhost REST API** (same server, `localhost:3000/api/context/*`) — how AI agents read user-consented context, authenticated via API keys

---

## Critical Security Constraint

This system runs on a machine where AI agents (Clawdbot/Openclaw agents) also run. These agents have full filesystem access including sudo. This means:

- **You cannot rely on filesystem permissions for security.** An agent can read any file on disk.
- **All vault files must be encrypted at rest** using AES-256-GCM, so raw file reads yield nothing useful.
- **The API server is the only path to decrypted content.** It holds the master key in memory (loaded from the system keychain at startup) and decrypts on-the-fly when serving authorized API requests.
- **The SQLite database is encrypted using SQLCipher** with a key derived from the master key. Even if an agent reads the database file directly, they cannot access metadata, permissions, or access logs.

### Threat Model

- **Attacker:** A Clawdbot agent running on the same machine with sudo access.
- **Attack vector:** Direct filesystem read of vault files, or direct read of the SQLite database.
- **Defense:** Encryption at rest for both vault files (AES-256-GCM) and the SQLite database (SQLCipher). The master key is stored in the macOS Keychain (or Linux secret-service via `libsecret`). The server loads the key into memory on startup. Even if an agent reads the encrypted files or the database, they cannot access plaintext content without going through the API.

**Known limitation (metadata exposure):** File metadata (original filenames, MIME types, sizes) is stored in the encrypted SQLite database. While the database itself is encrypted, once the server is running, any process that can query the API could potentially learn what files exist. For V0, we accept this limitation. A future version could encrypt metadata blobs per-file.

**Known limitation:** Once the master key is loaded into server memory, an attacker with sudo could theoretically extract it via debugger attach (`lldb`/`gdb`) or memory inspection (`/proc/{pid}/mem` on Linux). This is an inherent limitation of software-only encryption on a compromised host. Full mitigation would require hardware security modules (HSM) or secure enclaves, which are out of scope for V0. The keychain provides protection at rest and against casual filesystem access, not against a determined attacker with root privileges actively targeting the running process.

---

## Directory Structure

```
~/.membrane/
├── vault/                          # Encrypted file storage
│   ├── {folder_id}/                # One directory per user-created folder
│   │   ├── {file_id}.enc          # AES-256-GCM encrypted file
│   │   └── {file_id}.enc
│   └── {folder_id}/
├── db/
│   └── membrane.sqlite            # Metadata, permissions, API keys, access logs
├── keys/
│   └── master.key.enc             # Master key backup, encrypted with user's recovery password (PBKDF2)
└── config.yaml                    # Server configuration
```

### Folder and File Naming

- Folder IDs and file IDs are UUIDs. Human-readable names are stored in SQLite only.
- Encrypted files use `.enc` extension. The original filename and MIME type are stored in SQLite metadata.
- This ensures that even directory listings reveal nothing about the contents.

---

## Component 1: Encrypted Vault Layer

### Encryption Scheme

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Master key:** 256-bit key, generated on first run, stored in the system keychain
  - macOS: Use `security` CLI or `keytar` npm package to store/retrieve from Keychain
  - Linux: Use `libsecret` via `keytar`
  - **Test mode:** When `MEMBRANE_SKIP_KEYCHAIN=true`, the master key is held in memory only and not persisted to the keychain. This allows tests to run without touching the real keychain and enables CI environments without keychain access.
- **Master key backup:** On first run, the user provides a recovery password. The master key is encrypted using a key derived via PBKDF2 (100,000 iterations, SHA-256) from this password and saved to `~/.membrane/keys/master.key.enc`. If the keychain entry is lost, the user can restore from this backup by providing the recovery password.
- **Per-file encryption:** Each file gets a unique random IV (initialization vector). The IV is prepended to the ciphertext in the `.enc` file. Format: `[12-byte IV][ciphertext][16-byte auth tag]`
- **Key derivation:** Use the master key directly for file encryption. (In a production version, you'd derive per-folder keys, but for V0 the master key is sufficient.)

### Vault Operations

Implement these as a module (`vault.ts` or `vault.js`):

```
vault.init(recoveryPassword)       → Generate master key, store in keychain, create backup file, create directory structure, open database
vault.load()                       → Load master key from keychain into memory, open encrypted database (called on server start)
vault.isInitialized()              → Returns whether the vault has been set up
vault.restoreFromBackup(password)  → Decrypt master.key.enc with password, restore to keychain
vault.encryptAndStore(folderId, fileBuffer, metadata) → Encrypt file, write .enc, store metadata in SQLite
vault.decryptAndRead(fileId)       → Load .enc file, decrypt with master key, return plaintext buffer
vault.deleteFile(fileId)           → Remove .enc file and SQLite metadata
vault.createFolder(name)           → Create folder directory and SQLite record
vault.deleteFolder(folderId)       → Remove folder directory and all contents
```

---

## Component 2: SQLite Database Schema

Use SQLite with **SQLCipher encryption** (via `better-sqlite3` with `@journeyapps/sqlcipher` or `sql.js` with encryption support). The database key is derived from the master key using HKDF (SHA-256, info: "membrane-db"). This ensures the database cannot be read without the master key.

The database stores all metadata, permissions, and access logs.

```sql
-- User-created context folders
CREATE TABLE folders (
    id TEXT PRIMARY KEY,             -- UUID
    name TEXT NOT NULL,              -- Human-readable name (e.g., "Work", "Chat History")
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Files within folders (metadata only — content is encrypted on disk)
CREATE TABLE files (
    id TEXT PRIMARY KEY,             -- UUID
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,     -- Original filename
    mime_type TEXT,                  -- MIME type
    size_bytes INTEGER,             -- Original file size (pre-encryption)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Registered AI agents/applications
CREATE TABLE agents (
    id TEXT PRIMARY KEY,             -- UUID
    name TEXT NOT NULL,              -- Display name (e.g., "Clawdbot Research Agent")
    api_key_hash TEXT NOT NULL,      -- SHA-256 hash of the API key (hex-encoded)
    api_key_prefix TEXT NOT NULL,    -- First 12 chars of key for display (e.g., "mb_sk_a1b2c3")
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Grants: which agent can access which folder (user-initiated)
CREATE TABLE grants (
    id TEXT PRIMARY KEY,             -- UUID
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, folder_id)
);

-- GUI user sessions (for httpOnly cookie auth)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,             -- Session token (random 32-byte hex)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for query performance
CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE INDEX idx_grants_agent_id ON grants(agent_id);
CREATE INDEX idx_grants_folder_id ON grants(folder_id);
```

**Note on the `grants` table:** There is no `status` or `pending` state. Grants are binary — they either exist (access granted) or they don't. The user creates grants proactively from the GUI. The old `consent` table with `pending/approved/denied/revoked` states has been replaced by this simpler model.

---

## Component 3: Localhost Web GUI (Next.js)

A Next.js app running on `localhost:3000`. This serves both the user dashboard and the agent API (via Next.js API routes). It has four pages plus authentication:

### GUI Authentication

The GUI requires session-based authentication to prevent malicious local processes from accessing the dashboard endpoints:

- **Session token:** Stored in an `httpOnly`, `Secure=false` (localhost), `SameSite=Strict` cookie
- **Login flow:** User enters their recovery password (the same one used for the master key backup). The server verifies it can decrypt `master.key.enc` with this password. On success, a session token is generated and stored in the cookie.
- **Session storage:** Sessions are stored in the encrypted SQLite database (no expiration in V0)
- **Protected routes:** All GUI pages and internal API routes (not `/api/context/*`) require a valid session
- **Why this works:** An agent process cannot read `httpOnly` cookies from the browser. It would need the recovery password to authenticate.

### Pages

#### Page 1: Vault Manager (`/vault`)

- Shows all folders as cards in a grid layout
- Each folder card shows: name, file count, created date
- Click a folder to see its contents (file list with names, sizes, dates)
- Actions: Create folder, rename folder, delete folder
- Upload files into a folder via drag-and-drop or file picker
- Delete individual files
- This is the main landing page after setup

#### Page 2: Permissions Dashboard (`/permissions`)

This is the core of the user-initiated sharing model. The user comes here to proactively control what each agent can see.

- Shows all registered agents in a list
- Click an agent to open its detail/edit view
- **Agent detail view shows a checklist of ALL folders** with toggles (on/off) for each
  - Toggle ON = create a grant record (agent can now access this folder via API)
  - Toggle OFF = delete the grant record (access revoked immediately)
- The user can also disconnect (delete) an agent entirely, which revokes all grants and invalidates the API key
- Visual design inspired by Google Security's third-party access panel

**Key UX principle:** Agents never request access. The user decides what to share and with whom. This is like sharing a Google Drive folder — you pick the folder, you pick the person, you grant access.

#### Page 3: Agent Registration (`/agents`)

- Form to register a new AI agent: name
- On registration, generate and display the API key ONCE (with copy button and warning that it won't be shown again)
- API key format: `mb_sk_{random_string}` (e.g., `mb_sk_a1b2c3d4e5f6...`)
- List existing agents with ability to delete agents
- After registering an agent, prompt the user: "Share folders with this agent?" with a link to the Permissions Dashboard

### Setup Flow (First Run)

- On first visit, if no vault exists, show a setup wizard:
  1. "Welcome to Membrane"
  2. **Ask user to create a recovery password** (with confirmation field). Explain this password is used to:
     - Log into the GUI
     - Recover if the system keychain is lost
  3. Generate master key, store in keychain, create encrypted backup (`master.key.enc`)
  4. Initialize encrypted SQLite database
  5. Create session and redirect to vault manager

### Design Guidelines

- Clean, minimal design. Use Tailwind CSS.
- Use shadcn/ui components if convenient, but don't over-engineer. Simple is better.
- Light color scheme, professional look. Think linear.app or vercel.com dashboard aesthetics.
- Responsive is not critical (this is localhost), but should look good at standard laptop widths.

---

## Component 4: Agent REST API (`localhost:3000/api/context/*`)

The agent API is served by the same Next.js server on port 3000, under the `/api/context/*` path. This keeps the architecture simple (single process, single port) while clearly separating agent-facing endpoints from GUI-facing endpoints.

### Authentication

- API key-based auth via `Authorization: Bearer mb_sk_...` header
- On every request: hash the provided key with SHA-256, look up the agent by hash, reject if not found
- **No session cookie required** — agents authenticate exclusively via API key

### Sharing Model: User-Initiated

**Agents do not request access.** The user proactively grants folder access to agents via the GUI. From the agent's perspective, it simply calls the API and either has access (because the user granted it) or doesn't (403). There is no consent request flow, no polling, no pending state.

This means the agent integration is dead simple:
1. Developer registers an agent in the GUI, gets an API key
2. User shares folders with that agent in the Permissions Dashboard
3. Agent calls the API with its key and reads whatever it has been granted access to

### API Endpoints

```
# Health check
GET  /api/health                          → { status: "ok", version: "0.1.0" }

# Context access (agent-facing, requires valid API key + folder grant)
GET  /api/context/folders                 → List folders the agent has been granted access to
     Response: { folders: [{ id, name, file_count }] }

GET  /api/context/folders/:folderId       → List files in a specific folder
     Response: { folder: { id, name }, files: [{ id, name, mime_type, size_bytes, created_at }] }

GET  /api/context/files/:fileId           → Get decrypted file content
     Response: File content with appropriate Content-Type header
     Headers include: X-File-Name, X-File-Size, Content-Type
     (For text files, return the text. For binary files, return the binary with correct MIME type.)
```

**That's it.** Three context endpoints plus a health check. No consent endpoints, no discovery endpoints, no folder listing for agents that haven't been granted access. The API surface is deliberately minimal.

### Enforcement Rules

- Every context endpoint (`/api/context/*`) MUST check that the requesting agent has a grant record for the relevant folder
- If an agent tries to access a folder it hasn't been granted, return `403 Forbidden` with body: `{ error: "no_access", message: "This agent has not been granted access to this folder. The user must grant access via the Membrane dashboard." }`
- If an agent tries to access a file in a folder it hasn't been granted, return `403 Forbidden` (look up the file's folder_id, check for a grant)
- If the API key is invalid or the agent doesn't exist, return `401 Unauthorized`

---

## Component 5: Admin API (`/api/admin/*`)

Internal API for vault management. Used by the GUI frontend and for programmatic/automated testing. This API provides full control over folders, files, agents, grants, and vault state.

### Authentication

- **Normal mode:** Protected by session auth (same `httpOnly` cookie as GUI pages)
- **Test mode:** When `MEMBRANE_TEST_MODE=true` environment variable is set, session auth is bypassed on admin routes. This enables fully automated test runs without browser interaction.

**Security note:** Test mode should NEVER be enabled in any environment where untrusted processes run. It's intended only for isolated test environments (CI, local test runs with a throwaway vault).

### Endpoints

```
# Setup & Vault Status
POST   /api/admin/setup                → Initialize vault { recoveryPassword }
                                         Creates master key, keychain entry, backup file, database
                                         Response: { success: true }

GET    /api/admin/vault/status         → Get vault state
                                         Response: { initialized: boolean }

# Session (for GUI login, also useful for testing normal auth flow)
POST   /api/admin/sessions             → Create session { recoveryPassword }
                                         Sets httpOnly cookie, returns { success: true }

DELETE /api/admin/sessions             → Logout (clear session)
                                         Response: { success: true }

# Folders
POST   /api/admin/folders              → Create folder { name }
                                         Response: { id, name, created_at }

GET    /api/admin/folders              → List all folders
                                         Response: { folders: [{ id, name, file_count, created_at }] }

GET    /api/admin/folders/:id          → Get folder details
                                         Response: { id, name, file_count, created_at, updated_at }

PATCH  /api/admin/folders/:id          → Rename folder { name }
                                         Response: { id, name, updated_at }

DELETE /api/admin/folders/:id          → Delete folder and all its files
                                         Response: { success: true }

# Files
POST   /api/admin/folders/:folderId/files  → Upload file (multipart/form-data)
                                              Form fields: file (the file), name? (override filename)
                                              Response: { id, name, mime_type, size_bytes, created_at }

GET    /api/admin/files/:id            → Get file content (for GUI preview)
                                         Response: File content with Content-Type header

GET    /api/admin/files/:id/metadata   → Get file metadata
                                         Response: { id, name, mime_type, size_bytes, folder_id, created_at }

DELETE /api/admin/files/:id            → Delete file
                                         Response: { success: true }

# Agents
POST   /api/admin/agents               → Register agent { name }
                                         Response: { id, name, api_key } (api_key shown ONCE)

GET    /api/admin/agents               → List all agents
                                         Response: { agents: [{ id, name, api_key_prefix, created_at }] }

GET    /api/admin/agents/:id           → Get agent details with grants
                                         Response: { id, name, api_key_prefix, grants: [{ folder_id, folder_name }] }

DELETE /api/admin/agents/:id           → Delete agent (removes all grants)
                                         Response: { success: true }

# Grants
POST   /api/admin/grants               → Create grant { agentId, folderId }
                                         Response: { id, agent_id, folder_id, granted_at }

DELETE /api/admin/grants/:id           → Revoke grant
                                         Response: { success: true }

GET    /api/admin/grants               → List all grants (optional ?agentId= or ?folderId= filter)
                                         Response: { grants: [{ id, agent_id, agent_name, folder_id, folder_name, granted_at }] }
```

### Error Responses

All admin endpoints return consistent error format:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

Common error codes:
- `vault_not_initialized` (400) — Setup hasn't been run yet
- `unauthorized` (401) — Invalid or missing session (when not in test mode)
- `not_found` (404) — Resource doesn't exist
- `invalid_password` (401) — Wrong recovery password for setup/login
- `already_exists` (409) — Resource already exists (e.g., duplicate grant)

---

## Implementation Plan (Test-Driven)

Build in this order. Each phase includes tests that verify the implementation before moving on.

### Phase 1: Vault + Encryption Layer
- Implement the vault module (init, load, encrypt, decrypt, CRUD operations)
- Implement keychain integration (store/retrieve master key)
- Implement master key backup (PBKDF2-encrypted file) and restore
- Implement SQLCipher-encrypted SQLite database

**Tests (unit, direct module access):**
- `vault.init()` creates directory structure, keychain entry (unless MEMBRANE_SKIP_KEYCHAIN), and backup file
- Encrypt a file, decrypt it, verify contents match
- Restore from backup with correct password succeeds
- Restore from backup with wrong password fails
- **Encryption verification:** Read `.enc` file directly from disk, verify it's not plaintext (doesn't contain original content)
- **Database encryption verification:** Read `membrane.sqlite` directly from disk, verify it's not readable SQL (first bytes are not "SQLite format")

### Phase 2: Admin API — Setup, Folders, Files
- Set up Next.js project with Tailwind
- Implement test mode flag (`MEMBRANE_TEST_MODE`) that bypasses session auth
- Implement `/api/admin/setup` endpoint
- Implement `/api/admin/vault/status` endpoint
- Implement `/api/admin/folders` CRUD endpoints
- Implement `/api/admin/files` endpoints (upload, read, delete)

**Tests (integration, via HTTP with test mode enabled):**
- `POST /api/admin/setup` initializes a fresh vault
- `GET /api/admin/vault/status` returns correct initialized state
- Create folder, list folders, verify it appears
- Rename folder, verify name changed
- Upload file to folder, read it back, verify content matches
- Delete file, verify it's gone
- Delete folder, verify files are cascade deleted

### Phase 3: Admin API — Agents, Grants, Sessions
- Implement `/api/admin/agents` CRUD endpoints
- Implement `/api/admin/grants` endpoints
- Implement `/api/admin/sessions` endpoints
- Implement session middleware for non-test-mode auth

**Tests (integration):**
- Register agent, verify API key is returned
- Register agent, verify API key is NOT returned on subsequent GET
- Delete agent, verify grants are cascade deleted
- Create grant, verify it appears in agent's grant list
- Revoke grant, verify it's removed
- Session login with correct password succeeds
- Session login with wrong password fails
- Without test mode: admin endpoints require valid session

### Phase 4: Agent API (Context Endpoints)
- Implement API key auth middleware for `/api/context/*` routes
- Implement the context endpoints (folders list, folder contents, file read)
- Wire up enforcement: context endpoints check grants before serving data

**Tests (integration, full flow):**
- Agent can list only granted folders (not all folders)
- Agent can read files in granted folders
- Agent gets 403 when accessing ungranted folder
- Agent gets 403 when accessing file in ungranted folder
- Agent gets 401 with invalid API key
- Revoke grant → agent immediately gets 403

### Phase 5: Web GUI
- Implement login page (uses `/api/admin/sessions`)
- Implement the setup wizard (uses `/api/admin/setup`)
- Build the vault manager page (uses `/api/admin/folders` and `/api/admin/files`)
- Build the agent registration page (uses `/api/admin/agents`)
- Build the permissions dashboard (uses `/api/admin/grants`)

**Tests (optional, browser-based if desired):**
- GUI tests are optional since all functionality is covered by API tests
- Can add Playwright tests for critical user flows if warranted

---

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Web GUI + API | Next.js 14+ (App Router), Tailwind CSS, shadcn/ui — single server on port 3000 |
| Database | SQLite with SQLCipher encryption (via `@journeyapps/sqlcipher` or similar) |
| Session Management | `httpOnly` cookies with session IDs stored in encrypted SQLite |
| Encryption | Node.js `crypto` module (AES-256-GCM) |
| Keychain | `keytar` npm package (cross-platform keychain access) |
| File IDs | `uuid` npm package |
| API Key Hashing | Node.js `crypto` module (SHA-256) — bcrypt is unnecessary since API keys are already high-entropy random strings |
| Testing | Jest or Vitest for unit/integration tests, native `fetch` for API tests |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMBRANE_TEST_MODE` | When `true`, bypasses session auth on `/api/admin/*` routes. **Never enable in production.** | `false` |
| `MEMBRANE_SKIP_KEYCHAIN` | When `true`, master key is held in memory only (not persisted to keychain). Enables tests and CI without keychain access. | `false` |
| `MEMBRANE_DATA_DIR` | Override the default data directory (`~/.membrane`). Useful for tests to use isolated directories. | `~/.membrane` |
| `MEMBRANE_PORT` | Port for the Next.js server | `3000` |

### Test Environment Setup

For automated tests, use an isolated data directory and skip keychain to avoid polluting real data:

```bash
# Run tests with isolated vault (no keychain, no auth)
MEMBRANE_TEST_MODE=true \
MEMBRANE_SKIP_KEYCHAIN=true \
MEMBRANE_DATA_DIR=/tmp/membrane-test-$(date +%s) \
npm test

# Or in package.json scripts:
"scripts": {
  "test": "MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true MEMBRANE_DATA_DIR=$(mktemp -d) vitest",
  "test:watch": "MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true MEMBRANE_DATA_DIR=/tmp/membrane-test vitest --watch"
}
```

Each test run gets a fresh vault. The test data directory can be deleted after tests complete.

---

## What Success Looks Like

When this V0 is complete, the following end-to-end flow should work:

1. User runs the app for the first time. The setup wizard asks for a recovery password, generates a master key, stores it in the keychain, creates an encrypted backup, and initializes the database.
2. User creates a "Work" folder and uploads a few documents into it via the GUI.
3. User goes to the Agent Registration page and registers "Clawdbot Research Agent." They receive an API key (`mb_sk_...`).
4. User goes to the Permissions Dashboard, clicks on "Clawdbot Research Agent," and toggles ON access to the "Work" folder.
5. An agent (or a curl command simulating one) calls `GET /api/context/folders` with the API key and sees the "Work" folder listed.
6. The agent calls `GET /api/context/folders/{id}` and sees the list of files.
7. The agent calls `GET /api/context/files/{id}` and receives the decrypted file content.
8. The agent tries to access a "Personal" folder (not granted) and gets `403 Forbidden`.
9. The user goes back to Permissions Dashboard and toggles OFF the "Work" folder for that agent.
10. The agent's next API call to that folder returns `403 Forbidden`.

**Security validation:** If an agent with sudo access reads `~/.membrane/vault/{folder_id}/{file_id}.enc` directly from the filesystem, they get encrypted gibberish.

### Automated Test Suite

The entire flow above should be verifiable via automated tests. Here's the test structure:

```typescript
// tests/e2e/full-flow.test.ts
// Run with: MEMBRANE_TEST_MODE=true npm test

describe('Membrane E2E Flow', () => {
  const baseUrl = 'http://localhost:3000';
  let workFolderId: string;
  let personalFolderId: string;
  let fileId: string;
  let agent: { id: string; apiKey: string };

  beforeAll(async () => {
    // Initialize fresh vault
    await fetch(`${baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryPassword: 'test-password-123' }),
    });
  });

  test('create folders', async () => {
    const work = await fetch(`${baseUrl}/api/admin/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Work' }),
    }).then(r => r.json());

    const personal = await fetch(`${baseUrl}/api/admin/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Personal' }),
    }).then(r => r.json());

    workFolderId = work.id;
    personalFolderId = personal.id;
    expect(work.name).toBe('Work');
  });

  test('upload file to Work folder', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['Hello, World!'], { type: 'text/plain' }), 'test.txt');

    const res = await fetch(`${baseUrl}/api/admin/folders/${workFolderId}/files`, {
      method: 'POST',
      body: formData,
    }).then(r => r.json());

    fileId = res.id;
    expect(res.name).toBe('test.txt');
    expect(res.size_bytes).toBe(13);
  });

  test('register agent', async () => {
    const res = await fetch(`${baseUrl}/api/admin/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Agent' }),
    }).then(r => r.json());

    agent = { id: res.id, apiKey: res.api_key };
    expect(res.api_key).toMatch(/^mb_sk_/);
  });

  test('agent cannot access folders before grant', async () => {
    const res = await fetch(`${baseUrl}/api/context/folders`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` },
    });
    const data = await res.json();

    // Agent sees empty list (no grants yet)
    expect(data.folders).toHaveLength(0);
  });

  test('grant agent access to Work folder', async () => {
    const res = await fetch(`${baseUrl}/api/admin/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, folderId: workFolderId }),
    }).then(r => r.json());

    expect(res.folder_id).toBe(workFolderId);
  });

  test('agent can list granted folders', async () => {
    const res = await fetch(`${baseUrl}/api/context/folders`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` },
    }).then(r => r.json());

    expect(res.folders).toHaveLength(1);
    expect(res.folders[0].name).toBe('Work');
  });

  test('agent can read file in granted folder', async () => {
    const res = await fetch(`${baseUrl}/api/context/files/${fileId}`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` },
    });

    const content = await res.text();
    expect(content).toBe('Hello, World!');
  });

  test('agent cannot access ungranted folder', async () => {
    const res = await fetch(`${baseUrl}/api/context/folders/${personalFolderId}`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('no_access');
  });

  test('revoke grant, agent loses access immediately', async () => {
    // Get the grant ID first
    const grants = await fetch(`${baseUrl}/api/admin/grants?agentId=${agent.id}`)
      .then(r => r.json());
    const grantId = grants.grants[0].id;

    await fetch(`${baseUrl}/api/admin/grants/${grantId}`, { method: 'DELETE' });

    const res = await fetch(`${baseUrl}/api/context/folders/${workFolderId}`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` },
    });

    expect(res.status).toBe(403);
  });

  test('invalid API key returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/context/folders`, {
      headers: { 'Authorization': 'Bearer mb_sk_invalid' },
    });

    expect(res.status).toBe(401);
  });
});

// Separate test for encryption verification (reads files directly from disk)
describe('Encryption Verification', () => {
  const dataDir = process.env.MEMBRANE_DATA_DIR || '~/.membrane';

  test('encrypted files are not readable as plaintext', async () => {
    // Get file path from metadata
    const metadata = await fetch(`${baseUrl}/api/admin/files/${fileId}/metadata`)
      .then(r => r.json());

    const encPath = `${dataDir}/vault/${metadata.folder_id}/${fileId}.enc`;
    const encryptedContent = await fs.readFile(encPath);

    // Should NOT contain the plaintext
    expect(encryptedContent.toString()).not.toContain('Hello, World!');
  });

  test('database file is encrypted', async () => {
    const dbPath = `${dataDir}/db/membrane.sqlite`;
    const dbContent = await fs.readFile(dbPath);

    // SQLite files start with "SQLite format 3\0"
    // SQLCipher encrypted files do NOT have this header
    const header = dbContent.slice(0, 16).toString();
    expect(header).not.toBe('SQLite format 3\0');
  });
});
```

### Quick Manual Test (curl)

For quick manual verification:

```bash
# Set test mode and start server
MEMBRANE_TEST_MODE=true npm run dev

# Initialize vault
curl -X POST http://localhost:3000/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"recoveryPassword": "test123"}'

# Create a folder
curl -X POST http://localhost:3000/api/admin/folders \
  -H "Content-Type: application/json" \
  -d '{"name": "Work"}'
# Returns: {"id": "abc-123", "name": "Work", ...}

# Upload a file (replace FOLDER_ID)
curl -X POST http://localhost:3000/api/admin/folders/FOLDER_ID/files \
  -F "file=@./test.txt"
# Returns: {"id": "def-456", "name": "test.txt", ...}

# Register an agent
curl -X POST http://localhost:3000/api/admin/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Agent"}'
# Returns: {"id": "ghi-789", "api_key": "mb_sk_...", ...}

# Grant access (replace IDs)
curl -X POST http://localhost:3000/api/admin/grants \
  -H "Content-Type: application/json" \
  -d '{"agentId": "AGENT_ID", "folderId": "FOLDER_ID"}'

# Now test the agent API (replace API_KEY)
curl -H "Authorization: Bearer API_KEY" \
  http://localhost:3000/api/context/folders

curl -H "Authorization: Bearer API_KEY" \
  http://localhost:3000/api/context/files/FILE_ID
```

---

## What NOT to Build (Out of Scope for V0)

- No chat history import/parsing (just manual file upload)
- No semantic search or vector embeddings
- No multi-user support (single user, local machine)
- No OAuth 2.0 or external identity providers (simple password + session auth is sufficient for local single-user)
- No HTTPS (localhost only, HTTP is fine)
- No rate limiting (local only)
- No mobile or responsive design
- No file previews in the GUI (just metadata and download)
- No agent write-back (read-only access for agents)
- No agent-initiated consent requests (user-initiated only)

