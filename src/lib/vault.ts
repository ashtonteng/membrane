import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHmac } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import type { Folder, FileMetadata, FolderWithCount } from './types'

// Constants
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100000
const PBKDF2_KEY_LENGTH = 32
const PBKDF2_DIGEST = 'sha256'

// In-memory state
let masterKey: Buffer | null = null
let db: ReturnType<typeof import('better-sqlite3')> | null = null

// Get data directory from environment or default
export function getDataDir(): string {
  return process.env.MEMBRANE_DATA_DIR || join(homedir(), '.membrane')
}

// Get paths for various components
export function getPaths() {
  const dataDir = getDataDir()
  return {
    dataDir,
    vaultDir: join(dataDir, 'vault'),
    dbDir: join(dataDir, 'db'),
    keysDir: join(dataDir, 'keys'),
    dbPath: join(dataDir, 'db', 'membrane.sqlite'),
    masterKeyBackupPath: join(dataDir, 'keys', 'master.key.enc'),
    configPath: join(dataDir, 'config.yaml'),
  }
}

// Check if vault is initialized
export function isInitialized(): boolean {
  const paths = getPaths()
  return existsSync(paths.dbPath) && existsSync(paths.masterKeyBackupPath)
}

// Check if vault is loaded (master key in memory)
export function isLoaded(): boolean {
  return masterKey !== null && db !== null
}

// Generate a new master key
function generateMasterKey(): Buffer {
  return randomBytes(32)
}

// Derive database key from master key using HKDF-like approach
function deriveDatabaseKey(masterKeyBuffer: Buffer): Buffer {
  // Use HMAC-SHA256 as a simple HKDF-Extract/Expand
  return createHmac('sha256', masterKeyBuffer)
    .update('membrane-db')
    .digest()
}

// Encrypt master key with recovery password for backup
function encryptMasterKeyForBackup(masterKeyBuffer: Buffer, recoveryPassword: string): Buffer {
  const salt = randomBytes(16)
  const derivedKey = pbkdf2Sync(recoveryPassword, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv)

  const encrypted = Buffer.concat([cipher.update(masterKeyBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: [16-byte salt][12-byte IV][ciphertext][16-byte auth tag]
  return Buffer.concat([salt, iv, encrypted, authTag])
}

// Decrypt master key from backup using recovery password
function decryptMasterKeyFromBackup(encryptedData: Buffer, recoveryPassword: string): Buffer {
  const salt = encryptedData.subarray(0, 16)
  const iv = encryptedData.subarray(16, 16 + IV_LENGTH)
  const authTag = encryptedData.subarray(encryptedData.length - AUTH_TAG_LENGTH)
  const ciphertext = encryptedData.subarray(16 + IV_LENGTH, encryptedData.length - AUTH_TAG_LENGTH)

  const derivedKey = pbkdf2Sync(recoveryPassword, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// Store master key in keychain (or skip if MEMBRANE_SKIP_KEYCHAIN is set)
async function storeMasterKeyInKeychain(masterKeyBuffer: Buffer): Promise<void> {
  if (process.env.MEMBRANE_SKIP_KEYCHAIN === 'true') {
    // In test mode, just keep in memory
    return
  }

  try {
    const keytar = await import('keytar')
    await keytar.default.setPassword('membrane', 'master-key', masterKeyBuffer.toString('hex'))
  } catch (error) {
    throw new Error(`Failed to store master key in keychain: ${error}`)
  }
}

// Load master key from keychain
async function loadMasterKeyFromKeychain(): Promise<Buffer | null> {
  if (process.env.MEMBRANE_SKIP_KEYCHAIN === 'true') {
    // In test mode, master key should already be in memory from init
    return masterKey
  }

  try {
    const keytar = await import('keytar')
    const keyHex = await keytar.default.getPassword('membrane', 'master-key')
    if (keyHex) {
      return Buffer.from(keyHex, 'hex')
    }
    return null
  } catch (error) {
    throw new Error(`Failed to load master key from keychain: ${error}`)
  }
}

// Initialize SQLite database with SQLCipher encryption
function initializeDatabase(_dbKey: Buffer): import('better-sqlite3').Database {
  const paths = getPaths()

  // Use better-sqlite3 directly (SQLCipher support deferred for later)
  // Note: In production, we would use @journeyapps/sqlcipher for database encryption
  const database = new Database(paths.dbPath)

  // Create tables
  database.exec(`
    -- User-created context folders
    CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Files within folders
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Registered AI agents
    CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        api_key_prefix TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Grants: which agent can access which folder
    CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(agent_id, folder_id)
    );

    -- GUI user sessions
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for query performance
    CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_grants_agent_id ON grants(agent_id);
    CREATE INDEX IF NOT EXISTS idx_grants_folder_id ON grants(folder_id);
  `)

  // Enable foreign keys
  database.pragma('foreign_keys = ON')

  return database
}

// Initialize vault (first-time setup)
export async function init(recoveryPassword: string): Promise<void> {
  if (isInitialized()) {
    throw new Error('Vault is already initialized')
  }

  const paths = getPaths()

  // Create directory structure
  mkdirSync(paths.vaultDir, { recursive: true })
  mkdirSync(paths.dbDir, { recursive: true })
  mkdirSync(paths.keysDir, { recursive: true })

  // Generate master key
  masterKey = generateMasterKey()

  // Store in keychain (or keep in memory for test mode)
  await storeMasterKeyInKeychain(masterKey)

  // Create encrypted backup
  const encryptedBackup = encryptMasterKeyForBackup(masterKey, recoveryPassword)
  writeFileSync(paths.masterKeyBackupPath, encryptedBackup)

  // Initialize database
  const dbKey = deriveDatabaseKey(masterKey)
  db = initializeDatabase(dbKey)
}

// Load vault (on server startup)
export async function load(): Promise<void> {
  if (!isInitialized()) {
    throw new Error('Vault is not initialized')
  }

  if (isLoaded()) {
    return // Already loaded
  }

  // Load master key from keychain
  masterKey = await loadMasterKeyFromKeychain()

  if (!masterKey) {
    throw new Error('Master key not found in keychain')
  }

  // Open database
  const dbKey = deriveDatabaseKey(masterKey)
  db = initializeDatabase(dbKey)
}

// Restore master key from backup (if keychain entry is lost)
export async function restoreFromBackup(recoveryPassword: string): Promise<void> {
  const paths = getPaths()

  if (!existsSync(paths.masterKeyBackupPath)) {
    throw new Error('Backup file not found')
  }

  const encryptedBackup = readFileSync(paths.masterKeyBackupPath)

  try {
    masterKey = decryptMasterKeyFromBackup(encryptedBackup, recoveryPassword)
  } catch {
    throw new Error('Invalid recovery password')
  }

  // Store back in keychain
  await storeMasterKeyInKeychain(masterKey)

  // Open database
  const dbKey = deriveDatabaseKey(masterKey)
  db = initializeDatabase(dbKey)
}

// Verify recovery password (for login)
export function verifyRecoveryPassword(recoveryPassword: string): boolean {
  const paths = getPaths()

  if (!existsSync(paths.masterKeyBackupPath)) {
    return false
  }

  const encryptedBackup = readFileSync(paths.masterKeyBackupPath)

  try {
    decryptMasterKeyFromBackup(encryptedBackup, recoveryPassword)
    return true
  } catch {
    return false
  }
}

// Encrypt a file and store it
export function encryptAndStore(
  folderId: string,
  fileBuffer: Buffer,
  metadata: { originalName: string; mimeType?: string }
): FileMetadata {
  if (!masterKey || !db) {
    throw new Error('Vault not loaded')
  }

  const paths = getPaths()
  const fileId = uuidv4()
  const folderPath = join(paths.vaultDir, folderId)

  // Ensure folder directory exists
  mkdirSync(folderPath, { recursive: true })

  // Encrypt file
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, masterKey, iv)
  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Write encrypted file: [IV][ciphertext][auth tag]
  const encryptedFile = Buffer.concat([iv, encrypted, authTag])
  writeFileSync(join(folderPath, `${fileId}.enc`), encryptedFile)

  // Store metadata in database
  const stmt = db.prepare(`
    INSERT INTO files (id, folder_id, original_name, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(fileId, folderId, metadata.originalName, metadata.mimeType || null, fileBuffer.length)

  // Return file metadata
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileMetadata
  return file
}

// Decrypt and read a file
export function decryptAndRead(fileId: string): { buffer: Buffer; metadata: FileMetadata } {
  if (!masterKey || !db) {
    throw new Error('Vault not loaded')
  }

  const paths = getPaths()

  // Get file metadata
  const metadata = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileMetadata | undefined
  if (!metadata) {
    throw new Error('File not found')
  }

  // Read encrypted file
  const encryptedPath = join(paths.vaultDir, metadata.folder_id, `${fileId}.enc`)
  if (!existsSync(encryptedPath)) {
    throw new Error('Encrypted file not found on disk')
  }

  const encryptedFile = readFileSync(encryptedPath)

  // Parse encrypted file: [IV][ciphertext][auth tag]
  const iv = encryptedFile.subarray(0, IV_LENGTH)
  const authTag = encryptedFile.subarray(encryptedFile.length - AUTH_TAG_LENGTH)
  const ciphertext = encryptedFile.subarray(IV_LENGTH, encryptedFile.length - AUTH_TAG_LENGTH)

  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return { buffer: decrypted, metadata }
}

// Delete a file
export function deleteFile(fileId: string): void {
  if (!masterKey || !db) {
    throw new Error('Vault not loaded')
  }

  const paths = getPaths()

  // Get file metadata first
  const metadata = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileMetadata | undefined
  if (!metadata) {
    throw new Error('File not found')
  }

  // Delete encrypted file from disk
  const encryptedPath = join(paths.vaultDir, metadata.folder_id, `${fileId}.enc`)
  if (existsSync(encryptedPath)) {
    unlinkSync(encryptedPath)
  }

  // Delete from database
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId)
}

// Create a folder
export function createFolder(name: string): Folder {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const paths = getPaths()
  const folderId = uuidv4()

  // Create folder directory
  mkdirSync(join(paths.vaultDir, folderId), { recursive: true })

  // Insert into database
  const stmt = db.prepare(`
    INSERT INTO folders (id, name)
    VALUES (?, ?)
  `)
  stmt.run(folderId, name)

  // Return folder
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as Folder
  return folder
}

// Get a folder by ID
export function getFolder(folderId: string): FolderWithCount | null {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const folder = db.prepare(`
    SELECT f.*, COUNT(files.id) as file_count
    FROM folders f
    LEFT JOIN files ON files.folder_id = f.id
    WHERE f.id = ?
    GROUP BY f.id
  `).get(folderId) as FolderWithCount | undefined

  return folder || null
}

// List all folders
export function listFolders(): FolderWithCount[] {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const folders = db.prepare(`
    SELECT f.*, COUNT(files.id) as file_count
    FROM folders f
    LEFT JOIN files ON files.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `).all() as FolderWithCount[]

  return folders
}

// Rename a folder
export function renameFolder(folderId: string, newName: string): Folder {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const stmt = db.prepare(`
    UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
  const result = stmt.run(newName, folderId)

  if (result.changes === 0) {
    throw new Error('Folder not found')
  }

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as Folder
  return folder
}

// Delete a folder and all its contents
export function deleteFolder(folderId: string): void {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const paths = getPaths()

  // Check folder exists
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId)
  if (!folder) {
    throw new Error('Folder not found')
  }

  // Delete folder directory and all contents
  const folderPath = join(paths.vaultDir, folderId)
  if (existsSync(folderPath)) {
    rmSync(folderPath, { recursive: true })
  }

  // Delete from database (cascades to files due to foreign key)
  db.prepare('DELETE FROM folders WHERE id = ?').run(folderId)
}

// List files in a folder
export function listFiles(folderId: string): FileMetadata[] {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const files = db.prepare(`
    SELECT * FROM files WHERE folder_id = ? ORDER BY created_at DESC
  `).all(folderId) as FileMetadata[]

  return files
}

// Get file metadata
export function getFileMetadata(fileId: string): FileMetadata | null {
  if (!db) {
    throw new Error('Vault not loaded')
  }

  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileMetadata | undefined
  return file || null
}

// Get database instance (for other modules)
export function getDb(): ReturnType<typeof import('better-sqlite3')> {
  if (!db) {
    throw new Error('Vault not loaded')
  }
  return db
}

// Close vault (cleanup)
export function close(): void {
  if (db) {
    db.close()
    db = null
  }
  masterKey = null
}

// Reset vault state (for testing)
export function reset(): void {
  close()
}
