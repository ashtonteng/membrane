# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Membrane is a local-first personal context vault that encrypts files with AES-256-GCM and lets users grant folder-level read access to AI agents via a localhost REST API. Data is stored in `~/.membrane/` with encrypted file storage and a SQLCipher-encrypted SQLite database.

## Development Commands

```bash
# Development server
npm run dev

# Development with auth bypassed (for testing)
MEMBRANE_TEST_MODE=true MEMBRANE_SKIP_KEYCHAIN=true npm run dev

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npm test src/tests/vault.test.ts

# Run tests matching a pattern
npm test -- -t "should encrypt"

# Lint
npm run lint

# Build
npm run build
```

## Architecture

**Two-tier API design:**
- **Admin API** (`/api/admin/*`) - Session-protected routes for vault management (folders, files, agents, grants)
- **Agent API** (`/api/context/*`) - API key-authenticated routes for agents to read granted content

**Core libraries:**
- `src/lib/vault.ts` - Encryption/decryption operations (AES-256-GCM)
- `src/lib/db.ts` - SQLCipher database operations for agents, grants, sessions
- `src/lib/auth.ts` - Session authentication for admin routes
- `src/lib/apiAuth.ts` - API key authentication for agent routes

**Test structure:** Tests are in `src/tests/` and use Vitest. The test setup (`src/tests/setup.ts`) automatically sets `MEMBRANE_TEST_MODE` and `MEMBRANE_SKIP_KEYCHAIN`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MEMBRANE_TEST_MODE` | Bypasses session auth on admin routes |
| `MEMBRANE_SKIP_KEYCHAIN` | Master key held in memory only (no keytar) |
| `MEMBRANE_DATA_DIR` | Override data directory (default: `~/.membrane`) |

## Claude Code Skills

The `.claude/skills/` directory contains skills for interacting with the vault:
- `membrane` - Main skill for vault access and file operations
- `membrane-import` - Import existing folder structure into a new vault
- `membrane-test-setup` - Test environment setup
