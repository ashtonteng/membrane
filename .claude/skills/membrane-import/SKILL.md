---
name: membrane-import
description: Initialize a Membrane vault from an existing folder structure, importing subfolders and their files
argument-hint: <source_folder> [--dry-run]
user-invocable: true
allowed-tools: Bash, Read, AskUserQuestion
---

# Membrane Import Skill

Initialize a new Membrane vault by importing an existing folder structure. Each subfolder in the source directory becomes a vault folder, and all files within are uploaded.

## Command Syntax

```
/membrane-import <source_folder> [--dry-run]
```

**Arguments:**
- `source_folder` (required): Path to folder containing subfolders to import

**Options:**
- `--dry-run`: Preview what would be imported without making changes

## Implementation Steps

Execute these steps in sequence:

### 1. Parse Arguments

Extract source folder path and check for `--dry-run` flag from the command arguments.

### 2. Prerequisites Check

```bash
BASE_URL="${MEMBRANE_URL:-http://localhost:3000}"

# Check server is running
HEALTH=$(curl -s -f "$BASE_URL/api/health" 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "Error: Cannot connect to Membrane at $BASE_URL"
  echo "Start the server with: MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev"
  exit 1
fi

# Check vault is NOT already initialized
STATUS=$(curl -s "$BASE_URL/api/admin/vault/status" 2>/dev/null || echo '{}')
INITIALIZED=$(echo "$STATUS" | jq -r '.initialized // false')
if [ "$INITIALIZED" = "true" ]; then
  echo "Error: Vault already exists at $BASE_URL"
  echo "This skill creates new vaults only."
  echo "To reset: rm -rf ~/.membrane"
  exit 1
fi
```

### 3. Validate Source Folder

```bash
SOURCE_FOLDER="$1"  # From command arguments

# Check folder exists
if [ ! -d "$SOURCE_FOLDER" ]; then
  echo "Error: Source folder does not exist: $SOURCE_FOLDER"
  exit 1
fi

# Check for subfolders
SUBFOLDER_COUNT=$(find "$SOURCE_FOLDER" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
if [ "$SUBFOLDER_COUNT" -eq 0 ]; then
  echo "Error: No subfolders found in $SOURCE_FOLDER"
  echo "Each subfolder becomes a vault folder. Please organize files into subfolders first."
  exit 1
fi
```

### 4. Scan and Display Preview

Scan the source folder structure:

```bash
echo "Source: $SOURCE_FOLDER"
echo ""
echo "Folders to import:"

TOTAL_FILES=0
TOTAL_SIZE=0

for SUBFOLDER in "$SOURCE_FOLDER"/*/; do
  if [ -d "$SUBFOLDER" ]; then
    FOLDER_NAME=$(basename "$SUBFOLDER")
    FILE_COUNT=$(find "$SUBFOLDER" -maxdepth 1 -type f | wc -l | tr -d ' ')
    FOLDER_SIZE=$(du -sh "$SUBFOLDER" 2>/dev/null | cut -f1)
    echo "  - $FOLDER_NAME ($FILE_COUNT files, $FOLDER_SIZE)"
    TOTAL_FILES=$((TOTAL_FILES + FILE_COUNT))
  fi
done

echo ""
echo "Total: $SUBFOLDER_COUNT folders, $TOTAL_FILES files"
```

### 5. Dry-Run Mode

If `--dry-run` flag is present, display the preview and exit:

```
Dry run complete. No changes made.

To import these folders, run:
/membrane-import <source_folder>
```

### 6. Get Recovery Password

Use the AskUserQuestion tool to prompt the user for a recovery password:

**Question:** "Enter a recovery password for the new vault (minimum 8 characters). This password encrypts your vault's master key and is required to unlock the vault on new devices."

**Header:** "Password"

**Options:** None (free text input via "Other")

After receiving the password:
- Validate it has at least 8 characters
- If too short, show error and ask again

### 7. Initialize Vault

```bash
INIT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/setup" \
  -H "Content-Type: application/json" \
  -d "{\"recoveryPassword\": \"$RECOVERY_PASSWORD\"}")

# Check for errors
ERROR=$(echo "$INIT_RESPONSE" | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "Error initializing vault: $ERROR"
  exit 1
fi

echo "Vault initialized successfully"
```

### 8. Import Folders and Files

For each subfolder in the source directory:

```bash
FOLDERS_IMPORTED=0
FILES_IMPORTED=0
ERRORS=0

for SUBFOLDER in "$SOURCE_FOLDER"/*/; do
  if [ -d "$SUBFOLDER" ]; then
    FOLDER_NAME=$(basename "$SUBFOLDER")
    echo "Importing folder: $FOLDER_NAME"

    # Create folder
    FOLDER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/folders" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"$FOLDER_NAME\"}")

    FOLDER_ID=$(echo "$FOLDER_RESPONSE" | jq -r '.id // empty')

    if [ -z "$FOLDER_ID" ]; then
      echo "  Warning: Failed to create folder '$FOLDER_NAME', skipping"
      ERRORS=$((ERRORS + 1))
      continue
    fi

    FOLDERS_IMPORTED=$((FOLDERS_IMPORTED + 1))

    # Upload files in this folder
    for FILE in "$SUBFOLDER"*; do
      if [ -f "$FILE" ]; then
        FILENAME=$(basename "$FILE")
        echo "  Uploading: $FILENAME"

        UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/folders/$FOLDER_ID/files" \
          -F "file=@$FILE")

        FILE_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.id // empty')

        if [ -z "$FILE_ID" ]; then
          echo "    Warning: Failed to upload '$FILENAME'"
          ERRORS=$((ERRORS + 1))
        else
          FILES_IMPORTED=$((FILES_IMPORTED + 1))
        fi
      fi
    done
  fi
done
```

### 9. Output Summary

Display the final summary:

```
Import complete!

Folders imported: X
Files imported: Y
Errors: Z

To grant an agent access to these folders:
1. Open http://localhost:3000/agents to create an agent
2. Open http://localhost:3000/permissions to grant folder access
3. Copy the API key and run: /membrane setup <api_key>
```

If there were errors:
```
Some items failed to import. Check the output above for details.
```

## Error Handling

| Scenario | Action |
|----------|--------|
| Server not running | Show: "Cannot connect to Membrane at {base_url}. Start with: MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev" |
| Vault already exists | Show: "Vault already exists. This skill creates new vaults only. To reset: rm -rf ~/.membrane" |
| Source folder missing | Show: "Source folder does not exist: {path}" |
| No subfolders found | Show: "No subfolders found. Each subfolder becomes a vault folder. Please organize files into subfolders first." |
| Password too short | Show: "Password must be at least 8 characters" and prompt again |
| Folder creation fails | Log warning, increment error count, continue with remaining folders |
| File upload fails | Log warning, increment error count, continue with remaining files |

## Examples

### Dry Run

```
$ /membrane-import ~/Documents/vault-data --dry-run

Source: /Users/alice/Documents/vault-data

Folders to import:
  - work (5 files, 24K)
  - personal (3 files, 12K)
  - health (2 files, 8K)

Total: 3 folders, 10 files

Dry run complete. No changes made.

To import these folders, run:
/membrane-import ~/Documents/vault-data
```

### Full Import

```
$ /membrane-import ~/Documents/vault-data

Source: /Users/alice/Documents/vault-data

Folders to import:
  - work (5 files, 24K)
  - personal (3 files, 12K)
  - health (2 files, 8K)

Total: 3 folders, 10 files

[User prompted for recovery password]

Vault initialized successfully

Importing folder: work
  Uploading: roadmap.md
  Uploading: notes.txt
  Uploading: budget.xlsx
  Uploading: contacts.csv
  Uploading: meeting.md
Importing folder: personal
  Uploading: journal.md
  Uploading: goals.txt
  Uploading: recipes.md
Importing folder: health
  Uploading: medications.txt
  Uploading: checkup.md

Import complete!

Folders imported: 3
Files imported: 10
Errors: 0

To grant an agent access to these folders:
1. Open http://localhost:3000/agents to create an agent
2. Open http://localhost:3000/permissions to grant folder access
3. Copy the API key and run: /membrane setup <api_key>
```

## Notes

- Only direct subfolders are imported (not nested subfolders)
- Only files in each subfolder are uploaded (subdirectories within subfolders are ignored)
- Hidden files (starting with `.`) are included
- Large files may take time to upload; progress is shown for each file
- The vault is created in the default location (`~/.membrane`) unless `MEMBRANE_DATA_DIR` is set
