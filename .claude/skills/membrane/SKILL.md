---
name: membrane
description: Access Membrane vault to read user documents and files from their local encrypted vault
argument-hint: [command] [args...]
allowed-tools: Bash, Read, Write
---

# Membrane Vault Access

Access the user's local Membrane vault to read encrypted documents and files. Membrane is a local-first personal context vault that stores encrypted files on their filesystem.

## Commands

Handle these `/membrane` commands:

- `/membrane setup <api_key>` - Configure API key and validate connection
- `/membrane list folders` - List accessible folders
- `/membrane list files in <folder>` - List files in a folder
- `/membrane read <filename>` - Read file content
- `/membrane search <pattern>` - Search files by name pattern
- `/membrane health` - Check server status
- `/membrane test setup` - Create test environment with sample folders

Also respond to natural language queries like "show my membrane folders" or "read the roadmap file from membrane".

## Configuration

Load the API key from these sources (in priority order):
1. Environment variable: `$MEMBRANE_API_KEY`
2. Config file: `~/.membrane-claude-config.json` (JSON with `api_key` and `base_url` fields)

Load the base URL from:
1. Environment variable: `$MEMBRANE_URL` (default: `http://localhost:3000`)
2. Config file `base_url` field

## API Implementation

All Context API requests require Bearer authentication:

```bash
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/context/endpoint"
```

### Setup Command

When user runs `/membrane setup <api_key>`:

1. Validate the key starts with `mb_sk_`
2. Test connection by calling `GET {base_url}/api/context/folders`
3. If successful (200), save to `~/.membrane-claude-config.json`:
   ```json
   {
     "api_key": "mb_sk_...",
     "base_url": "http://localhost:3000"
   }
   ```
4. Set file permissions: `chmod 600 ~/.membrane-claude-config.json`
5. Report success with number of accessible folders

### List Folders

Call `GET {base_url}/api/context/folders` with Authorization header.

Response format:
```json
{
  "folders": [
    { "id": "uuid", "name": "work-projects", "file_count": 5 }
  ]
}
```

Display as:
```
Membrane Folders (2):
- work-projects (5 files)
- personal-notes (12 files)
```

### List Files in Folder

1. If folder name provided (not UUID), first call list folders to find the folder ID
2. Call `GET {base_url}/api/context/folders/{folder_id}`

Response format:
```json
{
  "folder": { "id": "uuid", "name": "work-projects" },
  "files": [
    {
      "id": "uuid",
      "name": "roadmap.md",
      "mime_type": "text/markdown",
      "size_bytes": 2048,
      "created_at": "..."
    }
  ]
}
```

Display as:
```
Files in "work-projects" (2):
- roadmap.md (2.0 KB, text/markdown)
- notes.txt (512 B, text/plain)
```

### Read File

1. If filename provided (not UUID), search across all folders to find the file ID:
   - List all folders
   - For each folder, list files
   - Find file with matching name
2. Call `GET {base_url}/api/context/files/{file_id}`
3. Response is raw file content with headers:
   - `Content-Type`: MIME type
   - `X-File-Name`: Original filename (URL-encoded)
   - `X-File-Size`: Size in bytes
4. Display the content. For binary files, note the type and size instead of content.

### Search Files

Search for files by name pattern across all granted folders:

1. List all folders
2. For each folder, list files
3. Filter files by pattern (support glob-style: `*.md`, `report*`, etc.)
4. Display aggregated results:

```
Found 3 files matching "*.md":
- work-projects/roadmap.md (2.0 KB)
- work-projects/meeting-notes.md (1.2 KB)
- personal-notes/ideas.md (856 B)
```

### Health Check

Call `GET {base_url}/api/health` (no auth required).

Response format:
```json
{ "status": "ok", "version": "0.1.0" }
```

## Error Handling

Handle these cases gracefully:

| HTTP Status | User Message |
|-------------|--------------|
| 401 | API key is invalid or expired. Run `/membrane setup <key>` with a new key from http://localhost:3000/agents |
| 403 | You don't have access to this folder. Ask the vault owner to grant access at http://localhost:3000/permissions |
| 404 | File or folder not found. |
| 500 | Membrane encountered an error. Check the server logs. |
| Network error | Cannot connect to Membrane at {base_url}. Is the server running? Start it with `npm run dev` in the membrane directory. |

### No API Key - Interactive Setup Flow

When no API key is found in env or config file, guide the user through setup interactively:

**Step 1: Check if server is running**

Call `GET {base_url}/api/health` (no auth required).

- If connection fails, tell the user: "Membrane server is not running. Please start it with `npm run dev` in the membrane directory, then try again."
- If server responds, continue to step 2.

**Step 2: Guide user to create an agent**

Tell the user:
```
Membrane is running but no API key is configured for this agent.

Please complete these steps in your browser:

1. Open http://localhost:3000/agents
2. Click "Create Agent" and give it a name (e.g., "claude-code")
3. IMPORTANT: Copy the API key shown - it's only displayed once!
4. Open http://localhost:3000/permissions
5. Toggle ON the folders you want to share with this agent
```

**Step 3: Ask for the API key**

After showing the instructions, ask the user: "What is the API key? (starts with mb_sk_)"

**Step 4: Complete setup**

Once the user provides the key:
1. Validate it starts with `mb_sk_`
2. Test connection by calling `GET {base_url}/api/context/folders`
3. If successful, save to `~/.membrane-claude-config.json` with `chmod 600`
4. Report: "Setup complete! You have access to X folders."
5. If the response shows 0 folders, remind the user: "No folders are shared yet. Grant access at http://localhost:3000/permissions"

## Helper Functions

Create these internal helper functions for reuse:

**load_config()**: Load API key and base URL from env or config file
**api_call(endpoint)**: Make authenticated GET request to Membrane API
**folder_name_to_id(name)**: Convert folder name to UUID by listing folders
**file_name_to_id(name)**: Search across all folders to find file UUID by name
**format_size(bytes)**: Format bytes as human-readable (KB, MB, etc.)

### Test Setup Command

When user runs `/membrane test setup`, create a complete test environment:

Prerequisites:
- Server running with `MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev`

Execute these steps in sequence:

1. Check vault status: `GET {base_url}/api/admin/vault/status`
2. If not initialized, initialize: `POST {base_url}/api/admin/setup` with `{"recoveryPassword": "testpassword123"}`
3. Create "work" folder: `POST {base_url}/api/admin/folders` with `{"name": "work"}`
4. Create "health" folder: `POST {base_url}/api/admin/folders` with `{"name": "health"}`
5. Create agent: `POST {base_url}/api/admin/agents` with `{"name": "claude-test"}`
6. Grant access to work folder: `POST {base_url}/api/admin/grants` with `{"agentId": "<id>", "folderId": "<work-id>"}`
7. Grant access to health folder: `POST {base_url}/api/admin/grants` with `{"agentId": "<id>", "folderId": "<health-id>"}`
8. Return API key and prompt user to run `/membrane setup <api_key>`

Handle errors gracefully (folders may already exist, grants may be duplicates).

## Notes

- API keys are stored locally with 600 permissions for security
- All vault data remains encrypted at rest; decryption happens only when reading via API
- Access is limited to folders explicitly granted by the vault owner
