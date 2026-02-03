# Membrane Vault Access Skill

Access your personal Membrane vault to read documents and files. Membrane is a local-first personal context vault that stores encrypted files on your local filesystem.

## Setup

Before using Membrane tools, you need an API key. The key can be provided via:
1. Environment variable: `MEMBRANE_API_KEY`
2. Config file: `~/.membrane-claude-config.json`

### First-Time Setup

If no API key is configured, guide the user through setup:

1. **Start the Membrane server** (if not running):
   ```bash
   cd <membrane-directory> && npm run dev
   ```

2. **Create an agent in the GUI**:
   - Open http://localhost:3000/agents
   - Click "Create Agent" and give it a name (e.g., "Claude Code")
   - Copy the one-time API key shown (format: `mb_sk_...`)

3. **Grant folder access**:
   - Go to http://localhost:3000/permissions
   - Toggle access for folders you want the agent to read

4. **Configure the API key**:
   Run `/membrane setup <api_key>` with the copied key.

## Configuration

The skill stores configuration in `~/.membrane-claude-config.json`:

```json
{
  "api_key": "mb_sk_...",
  "base_url": "http://localhost:3000"
}
```

Environment variables override the config file:
- `MEMBRANE_API_KEY` - API key
- `MEMBRANE_URL` - Base URL (default: http://localhost:3000)

## Tools

### membrane_setup

Configure the Membrane API key and validate the connection.

**Usage**: `/membrane setup <api_key>`

**Implementation**:
1. Validate key format starts with `mb_sk_`
2. Test connection: `GET {base_url}/api/context/folders` with `Authorization: Bearer <api_key>`
3. If successful (200), save key to `~/.membrane-claude-config.json`
4. Report success with number of accessible folders

**Example**:
```
User: /membrane setup mb_sk_abc123def456
Assistant: [Makes GET request to validate, saves config]
Response: "Connected to Membrane. You have access to 3 folders."
```

### membrane_list_folders

List all folders the agent has been granted access to.

**Usage**: `/membrane list folders` or natural language like "show my membrane folders"

**Implementation**:
1. Load API key from config or env
2. `GET {base_url}/api/context/folders` with `Authorization: Bearer <api_key>`
3. Parse response and format for display

**API Response**:
```json
{
  "folders": [
    { "id": "uuid", "name": "work-projects", "file_count": 5 },
    { "id": "uuid", "name": "personal-notes", "file_count": 12 }
  ]
}
```

**Formatted Output**:
```
Membrane Folders (2):
- work-projects (5 files)
- personal-notes (12 files)
```

### membrane_list_files

List files in a specific folder.

**Usage**: `/membrane list files in <folder_name>` or natural language

**Implementation**:
1. Load API key from config or env
2. If folder name provided (not ID), first call `list_folders` to find the folder ID
3. `GET {base_url}/api/context/folders/{folder_id}` with auth header
4. Parse and format response

**API Response**:
```json
{
  "folder": { "id": "uuid", "name": "work-projects" },
  "files": [
    { "id": "uuid", "name": "roadmap.md", "mime_type": "text/markdown", "size_bytes": 2048, "created_at": "..." },
    { "id": "uuid", "name": "notes.txt", "mime_type": "text/plain", "size_bytes": 512, "created_at": "..." }
  ]
}
```

**Formatted Output**:
```
Files in "work-projects" (2):
- roadmap.md (2.0 KB, text/markdown)
- notes.txt (512 B, text/plain)
```

### membrane_read_file

Read the decrypted content of a file.

**Usage**: `/membrane read <filename>` or `/membrane read file <file_id>`

**Implementation**:
1. Load API key from config or env
2. If filename provided (not ID), search across folders to find the file ID
3. `GET {base_url}/api/context/files/{file_id}` with auth header
4. Response is raw file content with headers:
   - `Content-Type`: MIME type
   - `X-File-Name`: Original filename (URL-encoded)
   - `X-File-Size`: Size in bytes

**Output**: Display file content. For binary files, note the type and size instead.

### membrane_get_folder_by_name

Find a folder by name pattern.

**Usage**: Called internally or via natural language like "find folder named projects"

**Implementation**:
1. Call `list_folders` to get all folders
2. Filter by case-insensitive name match or substring
3. Return matching folder(s)

### membrane_search_files

Search for files by name pattern across all granted folders.

**Usage**: `/membrane search <pattern>` or "find all markdown files in membrane"

**Implementation**:
1. Call `list_folders` to get all folders
2. For each folder, call `list_files`
3. Filter files by pattern (glob-style: `*.md`, `report*`, etc.)
4. Return aggregated results with folder context

**Output**:
```
Found 3 files matching "*.md":
- work-projects/roadmap.md (2.0 KB)
- work-projects/meeting-notes.md (1.2 KB)
- personal-notes/ideas.md (856 B)
```

### membrane_batch_read

Read multiple files at once.

**Usage**: `/membrane read files <file1>, <file2>` or provide file IDs

**Implementation**:
1. Resolve file names to IDs if needed
2. Call `read_file` for each file sequentially
3. Return combined results with clear separators

### membrane_health_check

Check if the Membrane server is running and accessible.

**Usage**: `/membrane health` or "check membrane status"

**Implementation**:
1. `GET {base_url}/api/health`
2. Report status and version

**API Response**:
```json
{ "status": "ok", "version": "0.1.0" }
```

## Error Handling

Handle these error cases gracefully:

| HTTP Status | Error | User Message |
|-------------|-------|--------------|
| 401 | `unauthorized` | "API key is invalid or expired. Run `/membrane setup <key>` with a new key from http://localhost:3000/agents" |
| 403 | `no_access` | "You don't have access to this folder. Ask the vault owner to grant access at http://localhost:3000/permissions" |
| 404 | `not_found` | "File or folder not found." |
| 500 | `internal_error` | "Membrane encountered an error. Check the server logs." |
| Network error | - | "Cannot connect to Membrane at {base_url}. Is the server running? Start it with `npm run dev` in the membrane directory." |

### No API Key Configured

When no API key is found, return setup instructions:

```
Membrane API key not configured.

To set up Membrane access:
1. Start the Membrane server: npm run dev (in the membrane directory)
2. Open http://localhost:3000/agents and create an agent
3. Copy the one-time API key shown
4. Go to http://localhost:3000/permissions and grant folder access
5. Run: /membrane setup <your_api_key>
```

## Implementation Details

### Loading Configuration

```bash
# Check environment variable first
if [ -n "$MEMBRANE_API_KEY" ]; then
  API_KEY="$MEMBRANE_API_KEY"
elif [ -f ~/.membrane-claude-config.json ]; then
  API_KEY=$(cat ~/.membrane-claude-config.json | jq -r '.api_key')
fi

BASE_URL="${MEMBRANE_URL:-http://localhost:3000}"
```

### Making API Requests

All Context API requests require the Authorization header:
```
Authorization: Bearer mb_sk_...
```

Use `curl` or equivalent HTTP tool:
```bash
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/context/folders"
```

### Saving Configuration

Write to `~/.membrane-claude-config.json`:
```bash
echo '{"api_key": "mb_sk_...", "base_url": "http://localhost:3000"}' > ~/.membrane-claude-config.json
chmod 600 ~/.membrane-claude-config.json
```

## Command Summary

| Command | Description |
|---------|-------------|
| `/membrane setup <key>` | Configure API key |
| `/membrane list folders` | List accessible folders |
| `/membrane list files in <folder>` | List files in a folder |
| `/membrane read <filename>` | Read file content |
| `/membrane search <pattern>` | Search files by name |
| `/membrane health` | Check server status |

## Security Notes

- API keys are stored locally in `~/.membrane-claude-config.json` with 600 permissions
- Keys are only valid for the specific Membrane instance that created them
- Access is limited to folders explicitly granted by the vault owner
- All vault data remains encrypted at rest; decryption happens only when reading
