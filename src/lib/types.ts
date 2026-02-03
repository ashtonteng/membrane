// Folder types
export interface Folder {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface FolderWithCount extends Folder {
  file_count: number
}

// File types
export interface FileMetadata {
  id: string
  folder_id: string
  original_name: string
  mime_type: string | null
  size_bytes: number
  created_at: string
  updated_at: string
}

// Agent types
export interface Agent {
  id: string
  name: string
  api_key_hash: string
  api_key_prefix: string
  created_at: string
}

export interface AgentPublic {
  id: string
  name: string
  api_key_prefix: string
  created_at: string
}

export interface AgentWithKey extends AgentPublic {
  api_key: string
}

export interface AgentWithGrants extends AgentPublic {
  grants: Array<{ folder_id: string; folder_name: string }>
}

// Grant types
export interface Grant {
  id: string
  agent_id: string
  folder_id: string
  granted_at: string
}

export interface GrantWithNames extends Grant {
  agent_name: string
  folder_name: string
}

// Session types
export interface Session {
  id: string
  created_at: string
}

// API response types
export interface ApiError {
  error: string
  message: string
}

export interface VaultStatus {
  initialized: boolean
}

// Context API response types (for agents)
export interface ContextFolder {
  id: string
  name: string
  file_count: number
}

export interface ContextFile {
  id: string
  name: string
  mime_type: string | null
  size_bytes: number
  created_at: string
}
