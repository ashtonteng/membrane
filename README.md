# Membrane

A local-first personal context vault that encrypts your files and lets you grant selective read access to AI agents.

## What is Membrane?

As AI agents become more capable, people are using multiple agents for different tasks: coding assistants, research tools, health trackers, personal assistants, and more. Each agent needs access to different context—your coding agent needs project files, your health agent needs medical records, your assistant needs your calendar and notes. But giving every agent access to everything is a security nightmare.

Membrane solves this by providing a centralized place to store personal files and manage which agents can access what. Think of it as a selectively permeable barrier between your personal data and AI agents—context flows through only where you explicitly allow it.

**The problem:**
- Agents need personal context to be useful
- Different agents need different files and secrets
- Giving agents unrestricted filesystem access is risky
- There's no central way to manage agent permissions

**Membrane provides:**

- **Centralized context storage** - One place for all your personal files, encrypted at rest with AES-256-GCM
- **Folder-based organization** - Group files by domain (work, health, personal, finances)
- **Per-agent permissions** - Grant each agent access only to the folders it needs
- **Simple API for agents** - Agents read files through a localhost REST API
- **Instant revocation** - Toggle permissions off and agents lose access immediately
- **Full visibility** - See exactly which agents have access to what, all in one dashboard

## Architecture

```
~/.membrane/
├── vault/           # Encrypted file storage (AES-256-GCM)
├── db/              # SQLCipher-encrypted SQLite database
├── keys/            # Master key backup (PBKDF2-encrypted)
└── config.yaml      # Server configuration
```

The server holds the master key in memory and is the only path to decrypted content. Even with filesystem access, agents see only encrypted gibberish without API authentication.

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/anthropics/membrane.git
cd membrane

# Install dependencies
npm install

# Start the development server
npm run dev
```

The server runs at `http://localhost:3000`.

## User Guide

This guide walks through the complete workflow: creating a vault, adding files, registering an agent, setting permissions, and accessing files via the API.

### Step 1: Initialize Your Vault

When you first visit `http://localhost:3000`, you'll be redirected to the setup page.

1. Navigate to `http://localhost:3000/setup`
2. Enter a **recovery password** (this is important - it's used to log in and recover your vault if needed)
3. Confirm your password
4. Click **Initialize Vault**

Behind the scenes, Membrane:
- Generates a 256-bit master encryption key
- Stores it in your system keychain (macOS Keychain, Linux libsecret)
- Creates an encrypted backup of the key protected by your recovery password
- Initializes the encrypted SQLite database

After setup, you're redirected to the vault manager.

### Step 2: Create Folders and Add Files

The vault page (`/vault`) is where you organize your files.

**Creating a folder:**
1. Click **New Folder**
2. Enter a name (e.g., "work-projects", "health-records", "personal-notes")
3. Click **Create**

**Adding files:**
1. Click on a folder to open it
2. Drag and drop files onto the upload area, or click to browse
3. Files are encrypted and stored immediately

Each file is encrypted with AES-256-GCM using a unique IV. The original filename and metadata are stored in the encrypted database.

### Step 3: Register an Agent

Navigate to the agents page (`/agents`) to register AI agents that need access to your files.

1. Click **Register Agent**
2. Enter a name for the agent (e.g., "Claude Code", "Research Assistant")
3. Click **Create**

**Important:** The API key is displayed **only once**. Copy it immediately and store it securely. The key format is `mb_sk_...`.

Example API key: `mb_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Step 4: Grant Folder Access

Navigate to the permissions page (`/permissions`) to control which agents can access which folders.

1. Click on an agent to see their current permissions
2. You'll see a list of all folders with toggle switches
3. Toggle **ON** to grant access to a folder
4. Toggle **OFF** to revoke access

Changes take effect immediately. If an agent is currently accessing a folder and you revoke access, their next request will fail with a 403 error.

### Step 5: Access Files via the Agent API

Agents access files through the Context API at `/api/context/*`. All requests require the API key in the Authorization header.

**List accessible folders:**

```bash
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/folders
```

Response:
```json
{
  "folders": [
    { "id": "abc-123", "name": "work-projects", "file_count": 5 },
    { "id": "def-456", "name": "health-records", "file_count": 3 }
  ]
}
```

**List files in a folder:**

```bash
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/folders/abc-123
```

Response:
```json
{
  "folder": { "id": "abc-123", "name": "work-projects" },
  "files": [
    {
      "id": "file-789",
      "name": "roadmap.md",
      "mime_type": "text/markdown",
      "size_bytes": 2048,
      "created_at": "2026-02-03T10:30:00Z"
    }
  ]
}
```

**Read a file's contents:**

```bash
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/files/file-789
```

The response body contains the decrypted file content with headers:
- `Content-Type`: The file's MIME type
- `X-File-Name`: URL-encoded original filename
- `X-File-Size`: Size in bytes

## Importing Existing Files

If you have an existing folder structure you want to import into Membrane, use the `/membrane-import` skill in Claude Code.

### Prerequisites

- Membrane server running (`npm run dev`)
- Vault NOT yet initialized (fresh install)
- Source folder with subfolders containing files

### Usage

```
# Dry run to see what would be imported
/membrane-import /path/to/your/folder --dry-run

# Perform the actual import
/membrane-import /path/to/your/folder
```

### How It Works

Given a folder structure like:

```
~/Documents/
├── work/
│   ├── project-plan.md
│   └── notes.txt
├── health/
│   ├── lab-results.pdf
│   └── medications.md
└── personal/
    └── journal.txt
```

Running `/membrane-import ~/Documents` will:

1. Prompt you for a recovery password
2. Initialize the vault
3. Create folders: "work", "health", "personal"
4. Upload and encrypt all files into their respective folders

After import:
- Create an agent via `/agents`
- Grant folder access via `/permissions`
- Start using the Context API

### Dry Run Mode

Use `--dry-run` to preview what would be imported without making changes:

```
/membrane-import ~/Documents --dry-run
```

Output:
```
DRY RUN - No changes will be made

Source: /Users/you/Documents
Folders to create: 3
Files to import: 5

work/ (2 files)
  - project-plan.md (1.2 KB)
  - notes.txt (256 B)

health/ (2 files)
  - lab-results.pdf (45.3 KB)
  - medications.md (512 B)

personal/ (1 file)
  - journal.txt (3.1 KB)

Run without --dry-run to perform import.
```

## Integrating Agents

Any AI agent that can make HTTP requests can integrate with Membrane. Register the agent, grant folder access, and have it call the Context API.

### Quick Start for Any Agent

1. **Register the agent** at `http://localhost:3000/agents` and copy the API key
2. **Grant folder access** at `http://localhost:3000/permissions`
3. **Call the API** with the Bearer token:

```bash
# List folders the agent can access
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/folders

# List files in a folder
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/folders/{folder_id}

# Read a file
curl -H "Authorization: Bearer mb_sk_your_api_key" \
  http://localhost:3000/api/context/files/{file_id}
```

The agent receives JSON responses for folder/file listings and raw file content for file reads.

### Claude Code

Membrane includes a built-in skill for Claude Code that wraps the API.

**Setup:**
1. Register an agent in Membrane (`/agents`)
2. Run `/membrane setup` in Claude Code
3. Enter your API key when prompted

**Commands:**

| Command | Description |
|---------|-------------|
| `/membrane setup <key>` | Configure API key |
| `/membrane list folders` | List accessible folders |
| `/membrane list files in <folder>` | List files in a folder |
| `/membrane read <filename>` | Read file content |
| `/membrane search <pattern>` | Search files by name |
| `/membrane health` | Check server status |

### Building Your Own Integration

To integrate Membrane with other agents or tools:

1. **Store the API key** securely in your agent's configuration
2. **Implement these endpoints:**
   - `GET /api/context/folders` → List granted folders
   - `GET /api/context/folders/:id` → List files in a folder
   - `GET /api/context/files/:id` → Get decrypted file content
3. **Handle errors:** 401 for invalid keys, 403 for unauthorized folder access
4. **Cache folder/file IDs** to avoid repeated lookups

See the [API Reference](#api-reference) for full endpoint documentation.

## API Reference

### Health Check

```
GET /api/health
```

Returns server status. No authentication required.

### Admin API

All admin endpoints require session authentication (via the web GUI) or `MEMBRANE_TEST_MODE=true`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/setup` | Initialize vault |
| GET | `/api/admin/vault/status` | Check vault status |
| POST | `/api/admin/sessions` | Login |
| DELETE | `/api/admin/sessions` | Logout |
| POST | `/api/admin/folders` | Create folder |
| GET | `/api/admin/folders` | List folders |
| GET | `/api/admin/folders/:id` | Get folder |
| PATCH | `/api/admin/folders/:id` | Rename folder |
| DELETE | `/api/admin/folders/:id` | Delete folder |
| POST | `/api/admin/folders/:folderId/files` | Upload file |
| GET | `/api/admin/files/:id` | Get file content |
| DELETE | `/api/admin/files/:id` | Delete file |
| POST | `/api/admin/agents` | Register agent |
| GET | `/api/admin/agents` | List agents |
| DELETE | `/api/admin/agents/:id` | Delete agent |
| POST | `/api/admin/grants` | Create grant |
| GET | `/api/admin/grants` | List grants |
| DELETE | `/api/admin/grants/:id` | Revoke grant |

### Context API (Agent Access)

All context endpoints require API key authentication via Bearer token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/context/folders` | List granted folders |
| GET | `/api/context/folders/:id` | List files in folder |
| GET | `/api/context/files/:id` | Get decrypted file |

## Security Model

### Encryption

- **Files**: AES-256-GCM with unique IV per file
- **Database**: SQLCipher-encrypted SQLite
- **Master key backup**: PBKDF2 (100k iterations, SHA-256) from recovery password

### Key Storage

The master encryption key is stored in your system's keychain:
- **macOS**: Keychain Access
- **Linux**: libsecret (GNOME Keyring, KWallet)

A PBKDF2-encrypted backup is also stored at `~/.membrane/keys/master.key.enc`.

### Agent Authentication

- API keys are SHA-256 hashed before storage
- Keys are never stored in plaintext
- Format: `mb_sk_{random_base64url}` (24 bytes of randomness)

### Threat Model

Membrane is designed for scenarios where AI agents have significant system access. Even with filesystem access, agents cannot:

- Read encrypted files without the API key
- Access folders without explicit grants
- Access the master key (stored in keychain, not on disk)

**Limitations**: An attacker with root/sudo access could potentially extract the master key from server memory using a debugger. Full mitigation would require hardware security modules.

## Development

### Commands

```bash
# Development server
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build

# Start production server
npm start

# Lint
npm run lint
```

### Test Mode

For development and testing, you can bypass authentication:

```bash
MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev
```

**Warning**: Never use test mode in production.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMBRANE_DATA_DIR` | `~/.membrane` | Vault storage location |
| `MEMBRANE_PORT` | `3000` | Server port |
| `MEMBRANE_TEST_MODE` | `false` | Bypass session auth (testing only) |
| `MEMBRANE_SKIP_KEYCHAIN` | `false` | Keep master key in memory only |

### Running Tests

The test suite includes 133 tests across vault encryption, database operations, admin API, and context API.

```bash
npm test
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Next.js 14+ (App Router)
- **Database**: SQLite with SQLCipher
- **Encryption**: Node.js crypto (AES-256-GCM)
- **Keychain**: keytar
- **UI**: React, Tailwind CSS, shadcn/ui
- **Testing**: Vitest

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a pull request.

## License

MIT
