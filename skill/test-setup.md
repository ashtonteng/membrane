# Membrane Test Environment Setup Skill

Set up a test Membrane vault with predefined folders and an agent for testing the membrane skill.

## Overview

This skill creates a complete test environment:
- Initializes the vault with a test password
- Creates "work" and "health" folders
- Registers a "claude-test" agent
- Grants the agent access to both folders
- Returns the API key for immediate use

## Prerequisites

- Membrane server running with `MEMBRANE_TEST_MODE=true` (bypasses GUI authentication)
- Server accessible at localhost:3000 (or `MEMBRANE_URL`)

## Starting the Test Server

```bash
cd /path/to/membrane
MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev
```

The environment variables:
- `MEMBRANE_TEST_MODE=true` - Bypasses session authentication on admin routes
- `MEMBRANE_SKIP_KEYCHAIN=true` - Keeps master key in memory only (no keychain required)

## Tool: membrane_test_setup

Set up the complete test environment and return the API key.

**Usage**: `/membrane test setup` or "set up membrane test environment"

**Implementation**:

Execute these steps in sequence using curl or HTTP requests:

### Step 1: Check if vault needs initialization

```bash
BASE_URL="${MEMBRANE_URL:-http://localhost:3000}"

# Check vault status
STATUS=$(curl -s "$BASE_URL/api/admin/vault/status")
INITIALIZED=$(echo "$STATUS" | jq -r '.initialized')
```

### Step 2: Initialize vault (if needed)

```bash
if [ "$INITIALIZED" = "false" ]; then
  curl -s -X POST "$BASE_URL/api/admin/setup" \
    -H "Content-Type: application/json" \
    -d '{"recoveryPassword": "testpassword123"}'
fi
```

### Step 3: Create folders

```bash
# Create "work" folder
WORK_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "work"}')
WORK_ID=$(echo "$WORK_FOLDER" | jq -r '.id')

# Create "health" folder
HEALTH_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "health"}')
HEALTH_ID=$(echo "$HEALTH_FOLDER" | jq -r '.id')
```

### Step 4: Create agent

```bash
AGENT=$(curl -s -X POST "$BASE_URL/api/admin/agents" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-test"}')
AGENT_ID=$(echo "$AGENT" | jq -r '.id')
API_KEY=$(echo "$AGENT" | jq -r '.api_key')
```

### Step 5: Grant folder access

```bash
# Grant access to work folder
curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$WORK_ID\"}"

# Grant access to health folder
curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$HEALTH_ID\"}"
```

### Step 6: Return results

Output the API key and folder information:

```
Test environment created successfully!

API Key: mb_sk_xxxxxxxxxxxxx

Folders created:
- work (id: <work-folder-id>)
- health (id: <health-folder-id>)

Agent "claude-test" has access to both folders.

To configure the membrane skill, run:
/membrane setup <api_key>
```

## Complete Script

Here's the complete bash script for reference:

```bash
#!/bin/bash
set -e

BASE_URL="${MEMBRANE_URL:-http://localhost:3000}"

echo "Setting up Membrane test environment..."

# Step 1: Check/initialize vault
STATUS=$(curl -s "$BASE_URL/api/admin/vault/status" 2>/dev/null || echo '{"initialized": false}')
INITIALIZED=$(echo "$STATUS" | jq -r '.initialized // false')

if [ "$INITIALIZED" = "false" ]; then
  echo "Initializing vault..."
  curl -s -X POST "$BASE_URL/api/admin/setup" \
    -H "Content-Type: application/json" \
    -d '{"recoveryPassword": "testpassword123"}' > /dev/null
fi

# Step 2: Create folders (ignore errors if they exist)
echo "Creating folders..."
WORK_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "work"}' 2>/dev/null || echo '{}')
WORK_ID=$(echo "$WORK_FOLDER" | jq -r '.id // empty')

HEALTH_FOLDER=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
  -H "Content-Type: application/json" \
  -d '{"name": "health"}' 2>/dev/null || echo '{}')
HEALTH_ID=$(echo "$HEALTH_FOLDER" | jq -r '.id // empty')

# If folders already exist, fetch their IDs
if [ -z "$WORK_ID" ] || [ -z "$HEALTH_ID" ]; then
  echo "Fetching existing folders..."
  FOLDERS=$(curl -s "$BASE_URL/api/admin/folders")
  WORK_ID=$(echo "$FOLDERS" | jq -r '.folders[] | select(.name=="work") | .id')
  HEALTH_ID=$(echo "$FOLDERS" | jq -r '.folders[] | select(.name=="health") | .id')
fi

# Step 3: Create agent
echo "Creating agent..."
AGENT=$(curl -s -X POST "$BASE_URL/api/admin/agents" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-test"}')
AGENT_ID=$(echo "$AGENT" | jq -r '.id')
API_KEY=$(echo "$AGENT" | jq -r '.api_key')

if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  echo "Error: Failed to create agent"
  echo "$AGENT"
  exit 1
fi

# Step 4: Grant access
echo "Granting folder access..."
curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$WORK_ID\"}" > /dev/null 2>&1 || true

curl -s -X POST "$BASE_URL/api/admin/grants" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\", \"folderId\": \"$HEALTH_ID\"}" > /dev/null 2>&1 || true

# Output results
echo ""
echo "========================================"
echo "Test environment created successfully!"
echo "========================================"
echo ""
echo "API Key: $API_KEY"
echo ""
echo "Folders created:"
echo "- work (id: $WORK_ID)"
echo "- health (id: $HEALTH_ID)"
echo ""
echo "Agent 'claude-test' has access to both folders."
echo ""
echo "To configure the membrane skill, run:"
echo "/membrane setup $API_KEY"
echo ""
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| Connection refused | Server not running | Start server with `MEMBRANE_TEST_MODE=true npm run dev` |
| 401 Unauthorized | Test mode not enabled | Restart server with `MEMBRANE_TEST_MODE=true` |
| 409 Conflict | Vault already initialized | This is fine - continue with folder creation |
| Folder creation fails | Folder may already exist | Fetch existing folders instead |

## Adding Test Files

After setup, you can add test files via the API:

```bash
# Add a file to the work folder
curl -X POST "$BASE_URL/api/admin/files" \
  -H "Content-Type: multipart/form-data" \
  -F "folderId=$WORK_ID" \
  -F "file=@/path/to/test-file.md"
```

Or use the GUI at http://localhost:3000/vault to upload files.

## Cleanup

To reset the test environment, delete the data directory:

```bash
rm -rf ~/.membrane
```

Then restart the server and run the setup again.
