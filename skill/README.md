# Membrane Claude Code Skill

Access your encrypted Membrane vault from Claude Code.

## Overview

This skill allows Claude Code to read files from your Membrane personal context vault. Membrane stores your documents encrypted on your local filesystem, and this skill provides secure read access via API keys.

## Prerequisites

- Membrane server running locally (`npm run dev`)
- An agent registered in Membrane with an API key
- Folder access granted to the agent

## Quick Start

### 1. Start Membrane

```bash
cd /path/to/membrane
npm run dev
```

The server runs at http://localhost:3000

### 2. Create an Agent

1. Open http://localhost:3000/agents
2. Click "Create Agent"
3. Name it "Claude Code" (or any name you prefer)
4. **Important**: Copy the API key shown - it's only displayed once!

### 3. Grant Folder Access

1. Go to http://localhost:3000/permissions
2. Find your agent in the list
3. Toggle access for folders you want Claude to read

### 4. Configure Claude Code

In Claude Code, run:

```
/membrane setup mb_sk_your_api_key_here
```

You should see confirmation that the connection works and how many folders are accessible.

## Commands

| Command | Description |
|---------|-------------|
| `/membrane setup <key>` | Configure your API key |
| `/membrane list folders` | Show folders you can access |
| `/membrane list files in <folder>` | List files in a folder |
| `/membrane read <filename>` | Read a file's content |
| `/membrane search <pattern>` | Find files by name (e.g., `*.md`) |
| `/membrane health` | Check if Membrane server is running |

## Natural Language

You can also use natural language:

- "Show my membrane folders"
- "What files are in the work-projects folder?"
- "Read the roadmap.md file from membrane"
- "Find all markdown files in my vault"

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMBRANE_API_KEY` | API key for authentication | - |
| `MEMBRANE_URL` | Membrane server URL | `http://localhost:3000` |

### Config File

Alternatively, configuration is stored in `~/.membrane-claude-config.json`:

```json
{
  "api_key": "mb_sk_...",
  "base_url": "http://localhost:3000"
}
```

Environment variables take precedence over the config file.

## Troubleshooting

### "Cannot connect to Membrane"

The server isn't running. Start it:
```bash
cd /path/to/membrane && npm run dev
```

### "API key is invalid"

Your key may have been regenerated. Create a new agent or get a fresh key:
1. Go to http://localhost:3000/agents
2. Delete the old agent and create a new one
3. Run `/membrane setup <new_key>`

### "You don't have access to this folder"

The vault owner needs to grant access:
1. Go to http://localhost:3000/permissions
2. Find your agent and toggle access for the folder

### "File not found"

The file may have been deleted or renamed. List files in the folder to see what's available:
```
/membrane list files in <folder_name>
```

## Security

- **Local-only**: Membrane runs on localhost; no data leaves your machine
- **Encrypted storage**: All files are encrypted at rest with AES-256-GCM
- **Scoped access**: Agents can only read folders explicitly granted to them
- **One-time keys**: API keys are shown only once when created

## API Reference

This skill uses the Membrane Context API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/context/folders` | GET | List granted folders |
| `/api/context/folders/:id` | GET | List files in folder |
| `/api/context/files/:id` | GET | Read file content |
| `/api/health` | GET | Health check |

All endpoints except `/api/health` require `Authorization: Bearer mb_sk_...` header.
