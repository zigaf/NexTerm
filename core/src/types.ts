// Core data models for NexTerm

export interface ServerConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'jump-host';

  // For password auth
  password?: string;

  // For key auth
  privateKeyPath?: string;
  passphrase?: string;

  // For jump-host
  jumpHost?: JumpHostConfig;

  // Server-specific variables (stored encrypted)
  variables: ServerVariable[];

  createdAt: Date;
  updatedAt: Date;
  lastConnectedAt?: Date;
  tags?: string[];
  color?: string;
}

export interface JumpHostConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKeyPath?: string;
}

export interface ServerVariable {
  id: string;
  name: string;           // e.g. "SUDO_PASSWORD", "MYSQL_ROOT_PASSWORD"
  description: string;    // e.g. "sudo password", "MySQL root password"
  value: string;          // stored encrypted in vault
  triggers: PromptTrigger[]; // when to auto-fill this variable
}

export interface PromptTrigger {
  pattern: string;        // regex pattern to detect in terminal output
  type: 'sudo' | 'mysql' | 'custom';
}

export interface ConnectionSession {
  id: string;
  serverId: string;
  connectedAt: Date;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

// Default triggers for common prompts
export const DEFAULT_TRIGGERS: Record<string, PromptTrigger[]> = {
  SUDO_PASSWORD: [
    { pattern: '\\[sudo\\] password for .+:', type: 'sudo' },
    { pattern: 'Password:', type: 'sudo' },
  ],
  MYSQL_ROOT_PASSWORD: [
    { pattern: 'Enter password:', type: 'mysql' },
    { pattern: 'mysql>', type: 'mysql' },
  ],
};
