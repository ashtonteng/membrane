---
name: membrane-test-setup
description: Set up a test Membrane vault environment with sample folders and agent for development/testing
user-invocable: true
allowed-tools: Bash
---

# Membrane Test Environment Setup

Set up a complete test Membrane vault with predefined folders and an agent for testing the membrane skill.

Invoke with `/membrane-test-setup` or via the main membrane skill with `/membrane test setup`.

## Prerequisites

Before running this setup:
- Membrane server must be running with `MEMBRANE_TEST_MODE=true` (bypasses GUI authentication)
- Server should be accessible at localhost:3000 (or `$MEMBRANE_URL`)

Start the test server with:
```bash
cd /path/to/membrane
MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev
```

## Setup Steps

Execute these steps in sequence using bash with curl:

### 1. Check Vault Status

```bash
BASE_URL="${MEMBRANE_URL:-http://localhost:3000}"
STATUS=$(curl -s "$BASE_URL/api/admin/vault/status" 2>/dev/null || echo '{"initialized": false}')
INITIALIZED=$(echo "$STATUS" | jq -r '.initialized // false')
```

### 2. Initialize Vault (if needed)

If `$INITIALIZED` is `false`, initialize the vault:

```bash
curl -s -X POST "$BASE_URL/api/admin/setup" \
  -H "Content-Type: application/json" \
  -d '{"recoveryPassword": "testpassword123"}'
```

### 3. Create Folders

Create "work" and "health" folders:

```bash
# Create work folder
WORK_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "work"}' 2>/dev/null || echo '{}')
WORK_ID=$(echo "$WORK_FOLDER" | jq -r '.id // empty')

# Create health folder
HEALTH_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "health"}' 2>/dev/null || echo '{}')
HEALTH_ID=$(echo "$HEALTH_FOLDER" | jq -r '.id // empty')

# If folders already exist, fetch their IDs
if [ -z "$WORK_ID" ] || [ -z "$HEALTH_ID" ]; then
  FOLDERS=$(curl -s "$BASE_URL/api/admin/folders")
  WORK_ID=$(echo "$FOLDERS" | jq -r '.folders[] | select(.name=="work") | .id')
  HEALTH_ID=$(echo "$FOLDERS" | jq -r '.folders[] | select(.name=="health") | .id')
fi
```

### 4. Create Sample Files

Upload sample files to the folders using multipart form data:

```bash
# Create sample files in work folder
echo -e "# Product Roadmap\n\n## Q1 2025\n- Launch MVP\n- User testing\n\n## Q2 2025\n- Scale infrastructure\n- Add collaboration features" > /tmp/roadmap.md
curl -s -X POST "$BASE_URL/api/admin/folders/$WORK_ID/files" \
  -F "file=@/tmp/roadmap.md;type=text/markdown"

echo -e "# Team Meeting Notes\n\nDate: 2025-01-15\n\n## Attendees\n- Alice\n- Bob\n- Charlie\n\n## Action Items\n1. Review PR #42\n2. Update documentation\n3. Schedule demo" > /tmp/meeting-notes.md
curl -s -X POST "$BASE_URL/api/admin/folders/$WORK_ID/files" \
  -F "file=@/tmp/meeting-notes.md;type=text/markdown"

# Create sample files in health folder
echo -e "Current Medications:\n- Vitamin D: 1000 IU daily\n- Omega-3: 500mg twice daily" > /tmp/medications.txt
curl -s -X POST "$BASE_URL/api/admin/folders/$HEALTH_ID/files" \
  -F "file=@/tmp/medications.txt;type=text/plain"

echo -e "# Annual Checkup 2025\n\nDate: January 10, 2025\nDoctor: Dr. Smith\n\n## Results\n- Blood pressure: 120/80\n- Heart rate: 72 bpm\n- All vitals normal\n\n## Recommendations\n- Continue exercise routine\n- Schedule dental cleaning" > /tmp/checkup-2025.md
curl -s -X POST "$BASE_URL/api/admin/folders/$HEALTH_ID/files" \
  -F "file=@/tmp/checkup-2025.md;type=text/markdown"

# Clean up temp files
rm -f /tmp/roadmap.md /tmp/meeting-notes.md /tmp/medications.txt /tmp/checkup-2025.md
```

### 5. Create Agent

Create a "claude-test" agent:

```bash
AGENT=$(curl -s -X POST "$BASE_URL/api/admin/agents" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-test"}')
AGENT_ID=$(echo "$AGENT" | jq -r '.id')
API_KEY=$(echo "$AGENT" | jq -r '.api_key')
```

Verify the API key was created:
```bash
if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  echo "Error: Failed to create agent"
  exit 1
fi
```

### 6. Grant Folder Access

Grant the agent access to both folders:

```bash
# Grant access to work folder
curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$WORK_ID\"}" 2>&1 || true

# Grant access to health folder
curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$HEALTH_ID\"}" 2>&1 || true
```

### 7. Display Results

Output the setup information:

```
Test environment created successfully!

API Key: mb_sk_xxxxxxxxxxxxx

Folders created:
- work (id: <work-folder-id>) - 2 files
- health (id: <health-folder-id>) - 2 files

Sample files:
- work/roadmap.md
- work/meeting-notes.md
- health/medications.txt
- health/checkup-2025.md

Agent "claude-test" has access to both folders.

To configure the membrane skill, run:
/membrane setup <api_key>
```

## Error Handling

| Error | Cause | User Message |
|-------|-------|--------------|
| Connection refused | Server not running | Cannot connect to Membrane at {base_url}. Start the server with: `MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev` |
| 401 Unauthorized | Test mode not enabled | Test mode not enabled. Restart server with `MEMBRANE_TEST_MODE=true` |
| 409 Conflict on vault init | Vault already initialized | (This is fine - continue with folder creation) |
| Folder creation returns empty | Folder may already exist | Fetch existing folders instead using GET /api/admin/folders |
| Agent creation fails | - | Error: Failed to create agent. Check server logs. |

## Implementation

Use bash to execute the complete setup script in a single call. Combine all steps into one script that handles errors gracefully and returns the final API key.

The script should:
1. Check vault status
2. Initialize if needed (handle 409 conflicts)
3. Create folders (handle existing folders)
4. Create sample files in each folder
5. Create agent
6. Grant access (ignore duplicate grant errors)
7. Return formatted output with API key

After successful setup, prompt the user to run `/membrane setup <api_key>` to configure the membrane skill.

## Cleanup

To reset the test environment:
```bash
rm -rf ~/.membrane
```
Then restart the server and run the setup again.
