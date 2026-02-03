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
- **Master key backup:** On first run, the user provides a recovery password. The master key is encrypted using a key derived via PBKDF2 (100,000 iterations, SHA-256) from this password and saved to `~/.membrane/keys/master.key.enc`. If the keychain entry is lost, the user can restore from this backup by providing the recovery password.
- **Per-file encryption:** Each file gets a unique random IV (initialization vector). The IV is prepended to the ciphertext in the `.enc` file. Format: `[12-byte IV][ciphertext][16-byte auth tag]`
- **Key derivation:** Use the master key directly for file encryption. (In a production version, you'd derive per-folder keys, but for V0 the master key is sufficient.)

### Vault Operations

Implement these as a module (`vault.ts` or `vault.js`):

```
vault.init(recoveryPassword)       → Generate master key, store in keychain, create backup file, create directory structure
vault.unlock()                     → Load master key from keychain into memory, open encrypted database
vault.lock()                       → Clear master key from memory, close database (all operations will fail until unlock)
vault.isUnlocked()                 → Returns whether the vault is currently unlocked
vault.restoreFromBackup(password)  → Decrypt master.key.enc with password, restore to keychain
vault.encryptAndStore(folderId, fileBuffer, metadata) → Encrypt file, write .enc, store metadata in SQLite
vault.updateFile(fileId, fileBuffer) → Re-encrypt with new content, update metadata (size, updated_at)
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
    description TEXT,                -- Optional description
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
    description TEXT,                -- What this agent does
    api_key_hash TEXT NOT NULL,      -- SHA-256 hash of the API key (hex-encoded)
    api_key_prefix TEXT NOT NULL,    -- First 12 chars of key for display (e.g., "mb_sk_a1b2c3")
    status TEXT DEFAULT 'active',    -- active, revoked
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

-- Access log: every API request is logged (successes and denials)
CREATE TABLE access_log (
    id TEXT PRIMARY KEY,             -- UUID
    agent_id TEXT NOT NULL REFERENCES agents(id),
    folder_id TEXT,                  -- NULL if listing folders
    file_id TEXT,                    -- NULL if listing folder contents
    endpoint TEXT NOT NULL,          -- e.g., "/api/context/folders", "/api/context/files/{id}"
    result TEXT NOT NULL,            -- "success", "denied", "error"
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- GUI user sessions (for httpOnly cookie auth)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,             -- Session token (random 32-byte hex)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,    -- Session expiration (e.g., created_at + 24 hours)
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP  -- For idle timeout tracking
);

-- Indexes for query performance
CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE INDEX idx_grants_agent_id ON grants(agent_id);
CREATE INDEX idx_grants_folder_id ON grants(folder_id);
CREATE INDEX idx_access_log_agent_id ON access_log(agent_id);
CREATE INDEX idx_access_log_timestamp ON access_log(timestamp DESC);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

**Note on the `grants` table:** There is no `status` or `pending` state. Grants are binary — they either exist (access granted) or they don't. The user creates grants proactively from the GUI. The old `consent` table with `pending/approved/denied/revoked` states has been replaced by this simpler model.

---

## Component 3: Localhost Web GUI (Next.js)

A Next.js app running on `localhost:3000`. This serves both the user dashboard and the agent API (via Next.js API routes). It has four pages plus authentication:

### GUI Authentication

The GUI requires session-based authentication to prevent malicious local processes from accessing the dashboard endpoints:

- **Session token:** Stored in an `httpOnly`, `Secure=false` (localhost), `SameSite=Strict` cookie
- **Login flow:** User enters their recovery password (the same one used for the master key backup). The server verifies it can decrypt `master.key.enc` with this password. On success, a session token is generated and stored in the cookie.
- **Session storage:** Sessions are stored in the encrypted SQLite database with expiration (e.g., 24 hours)
- **Protected routes:** All GUI pages and internal API routes (not `/api/context/*`) require a valid session
- **Why this works:** An agent process cannot read `httpOnly` cookies from the browser. It would need the recovery password to authenticate.

### Vault Lock/Unlock

The GUI header includes a "Lock Vault" button:
- **Lock:** Clears the master key from server memory. All decrypt operations fail. The GUI shows a locked state.
- **Unlock:** User enters recovery password. Server loads master key back into memory. Normal operation resumes.
- When locked, agent API calls return `503 Service Unavailable` with message "Vault is locked."

The vault auto-locks after a configurable idle timeout (default: 30 minutes of no GUI activity).

### Pages

#### Page 1: Vault Manager (`/vault`)

- Shows all folders as cards in a grid layout
- Each folder card shows: name, description, file count, created date
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

#### Page 3: Activity Log (`/activity`)

- Chronological feed of all API access events
- Each entry shows: timestamp, agent name, action (which endpoint), which folder/file was accessed
- Simple filtering by agent or folder
- This builds user trust through transparency

#### Page 4: Agent Registration (`/agents`)

- Form to register a new AI agent: name, description
- On registration, generate and display the API key ONCE (with copy button and warning that it won't be shown again)
- API key format: `mb_sk_{random_string}` (e.g., `mb_sk_a1b2c3d4e5f6...`)
- List existing agents with ability to regenerate keys or delete agents
- After registering an agent, prompt the user: "Share folders with this agent?" with a link to the Permissions Dashboard

### Setup Flow (First Run)

- On first visit, if no vault exists, show a setup wizard:
  1. "Welcome to Membrane"
  2. **Ask user to create a recovery password** (with confirmation field). Explain this password is used to:
     - Log into the GUI
     - Unlock the vault after locking
     - Recover if the system keychain is lost
  3. Generate master key, store in keychain, create encrypted backup (`master.key.enc`)
  4. Initialize encrypted SQLite database
  5. Create default folder suggestions: "Documents", "Chat History", "Work", "Personal" (user can customize)
  6. Create session and redirect to vault manager

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
- On every request: hash the provided key with SHA-256, look up the agent by hash, reject if not found or revoked
- All requests are logged to the access_log table
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
     Response: { folders: [{ id, name, description, file_count }] }

GET  /api/context/folders/:folderId       → List files in a specific folder
     Response: { folder: { id, name }, files: [{ id, name, mime_type, size_bytes, created_at }] }

GET  /api/context/files/:fileId           → Get decrypted file content
     Response: File content with appropriate Content-Type header
     (For text files, return the text. For binary files, return the binary with correct MIME type.)

GET  /api/context/files/:fileId/metadata  → Get file metadata without content
     Response: { id, name, mime_type, size_bytes, folder_id, created_at }
```

**That's it.** Four context endpoints plus a health check. No consent endpoints, no discovery endpoints, no folder listing for agents that haven't been granted access. The API surface is deliberately minimal.

### Enforcement Rules

- Every context endpoint (`/api/context/*`) MUST check that the requesting agent has a grant record for the relevant folder
- If an agent tries to access a folder it hasn't been granted, return `403 Forbidden` with body: `{ error: "no_access", message: "This agent has not been granted access to this folder. The user must grant access via the Membrane dashboard." }`
- If an agent tries to access a file in a folder it hasn't been granted, return `403 Forbidden` (look up the file's folder_id, check for a grant)
- If the API key is invalid or the agent has been revoked, return `401 Unauthorized`
- If the vault is locked, return `503 Service Unavailable` with body: `{ error: "vault_locked", message: "The vault is currently locked. The user must unlock it via the Membrane dashboard." }`
- All requests (successful and denied) are logged to `access_log` with appropriate `result` value

---

## Implementation Plan

Build in this order:

### Phase 1: Vault + Encryption Layer
- Implement the vault module (init, encrypt, decrypt, lock/unlock, CRUD operations)
- Implement keychain integration (store/retrieve master key)
- Implement master key backup (PBKDF2-encrypted file) and restore
- Implement SQLCipher-encrypted SQLite database
- Write a simple test: encrypt a file, decrypt it, verify contents match
- Test lock/unlock flow

### Phase 2: Web GUI — Vault Manager + Agent Registration
- Set up Next.js project with Tailwind
- Implement session-based authentication (login page, session middleware, httpOnly cookie)
- Implement the setup wizard (first-run experience with recovery password)
- Implement vault lock/unlock UI
- Build the vault manager page (folder CRUD, file upload, file listing)
- Build the agent registration page (register agent, generate API key, list agents)
- Files are encrypted on upload and decrypted for preview in the GUI

### Phase 3: Agent API + Permissions
- Implement API key auth middleware for `/api/context/*` routes
- Implement the context endpoints (folders list, folder contents, file read)
- Handle vault-locked state (503 responses)
- Build the permissions dashboard (folder toggle grid per agent)
- Wire up enforcement: context endpoints check grants before serving data
- Implement access logging

### Phase 4: Activity Log + Polish
- Build the activity log page
- Add error handling and edge cases
- Test the full flow end-to-end: register agent → share folders → read context via API → revoke → verify 403

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

---

## What Success Looks Like

When this V0 is complete, the following end-to-end flow should work:

1. User runs the app for the first time. The setup wizard asks for a recovery password, generates a master key, stores it in the keychain, creates an encrypted backup, and creates default folders.
2. User uploads a few documents into the "Work" folder via the GUI.
3. User goes to the Agent Registration page and registers "Clawdbot Research Agent." They receive an API key (`mb_sk_...`).
4. User goes to the Permissions Dashboard, clicks on "Clawdbot Research Agent," and toggles ON access to the "Work" folder.
5. An agent (or a curl command simulating one) calls `GET /api/context/folders` with the API key and sees the "Work" folder listed.
6. The agent calls `GET /api/context/folders/{id}` and sees the list of files.
7. The agent calls `GET /api/context/files/{id}` and receives the decrypted file content.
8. The agent tries to access the "Personal" folder (not granted) and gets `403 Forbidden`.
9. The user checks the Activity Log and sees every access the agent made (including the denied attempt).
10. The user goes back to Permissions Dashboard and toggles OFF the "Work" folder for that agent.
11. The agent's next API call to that folder returns `403 Forbidden`.

**Security validation:** If an agent with sudo access reads `~/.membrane/vault/{folder_id}/{file_id}.enc` directly from the filesystem, they get encrypted gibberish.

### Quick Test Script

After the build is complete, the following curl commands should demonstrate the full API:

```bash
# Health check
curl http://localhost:3000/api/health

# List granted folders (replace with actual API key)
curl -H "Authorization: Bearer mb_sk_your_key_here" \
  http://localhost:3000/api/context/folders

# List files in a folder (replace folder_id)
curl -H "Authorization: Bearer mb_sk_your_key_here" \
  http://localhost:3000/api/context/folders/{folder_id}

# Read a file (replace file_id)
curl -H "Authorization: Bearer mb_sk_your_key_here" \
  http://localhost:3000/api/context/files/{file_id}

# Try accessing an ungranted folder (should return 403)
curl -H "Authorization: Bearer mb_sk_your_key_here" \
  http://localhost:3000/api/context/folders/{ungranted_folder_id}

# Try with invalid API key (should return 401)
curl -H "Authorization: Bearer mb_sk_invalid" \
  http://localhost:3000/api/context/folders

# Try when vault is locked (should return 503)
# (Lock the vault via GUI first, then try any context endpoint)
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

