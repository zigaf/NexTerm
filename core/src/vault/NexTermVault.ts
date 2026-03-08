import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ServerConnection, ServerVariable } from '../types';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class NexTermVault {
  private encryptionKey: Buffer;
  private vaultPath: string;
  private data: VaultData;

  constructor(vaultDir: string, masterPassword: string) {
    this.vaultPath = path.join(vaultDir, 'nexterm.vault');

    // Use per-vault random salt (stored in the vault file).
    // On first run the salt is generated; on subsequent runs it is read back.
    const existing = this.loadRaw();
    const salt = existing?.salt
      ? Buffer.from(existing.salt, 'base64')
      : crypto.randomBytes(32);

    this.encryptionKey = crypto.scryptSync(masterPassword, salt, KEY_LENGTH, {
      N: 16384, // 2^14
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024, // 64 MB
    });

    this.data = existing ?? { servers: {}, version: 1, salt: salt.toString('base64') };
    if (!this.data.salt) {
      // Migrate legacy vault: persist the new random salt
      this.data.salt = salt.toString('base64');
      this.persist();
    }
  }

  /** Zero the encryption key from memory. Call when the vault is no longer needed. */
  destroy(): void {
    this.encryptionKey.fill(0);
  }

  // ── Servers ────────────────────────────────────────────────────

  saveServer(server: ServerConnection): void {
    // Encrypt sensitive fields before storing
    const encrypted = this.encryptServer(server);
    this.data.servers[server.id] = encrypted;
    this.persist();
  }

  getServer(id: string): ServerConnection | null {
    const encrypted = this.data.servers[id];
    if (!encrypted) return null;
    return this.decryptServer(encrypted);
  }

  getAllServers(): ServerConnection[] {
    return Object.values(this.data.servers).map(s => this.decryptServer(s));
  }

  /** Returns server metadata without decrypting variable values.
   *  Suitable for list display where secrets are not needed. */
  getAllServersMeta(): Pick<ServerConnection, 'id' | 'name' | 'host' | 'username' | 'port' | 'authType'>[] {
    return Object.values(this.data.servers).map(s => ({
      id: s.id,
      name: s.name,
      host: s.host,
      username: s.username,
      port: s.port,
      authType: s.authType,
    }));
  }

  deleteServer(id: string): void {
    delete this.data.servers[id];
    this.persist();
  }

  // ── Export / Import ───────────────────────────────────────────

  exportServers(filePath: string): void {
    // Build export from encrypted storage — only extract non-sensitive metadata.
    // No decryption needed: id, name, host, username, port, authType are stored unencrypted.
    const servers = Object.values(this.data.servers).map(s => {
      const { _sensitive, ...rest } = s;
      return {
        id: rest.id,
        name: rest.name,
        host: rest.host,
        username: rest.username,
        port: rest.port,
        authType: rest.authType,
        privateKeyPath: rest.privateKeyPath,
        jumpHost: rest.jumpHost ? { host: rest.jumpHost.host, port: rest.jumpHost.port, username: rest.jumpHost.username, authType: rest.jumpHost.authType, privateKeyPath: rest.jumpHost.privateKeyPath } : undefined,
        variables: rest.variables.map(v => ({ id: v.id, name: v.name, description: v.description, value: '', triggers: v.triggers })),
      };
    });
    const exportData: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: servers as ServerConnection[],
    };
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), { mode: 0o600 });
  }

  importServers(filePath: string, mode: 'merge' | 'replace' = 'merge'): { imported: number; skipped: number } {
    const stat = fs.statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error('Import file exceeds 10 MB limit');
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const exportData: ExportData = JSON.parse(raw);

    if (!exportData.version || !Array.isArray(exportData.servers)) {
      throw new Error('Invalid export file format');
    }

    for (const server of exportData.servers) {
      this.validateServerSchema(server);
    }

    let imported = 0;
    let skipped = 0;

    if (mode === 'replace') {
      this.data.servers = {};
    }

    for (const server of exportData.servers) {
      if (mode === 'merge' && this.data.servers[server.id]) {
        skipped++;
        continue;
      }
      // Encrypt and store inline without persisting each time
      const encrypted = this.encryptServer(server);
      this.data.servers[server.id] = encrypted;
      imported++;
    }

    if (imported > 0) this.persist();

    return { imported, skipped };
  }

  // ── Variables ──────────────────────────────────────────────────

  getVariableValue(serverId: string, variableId: string): string | null {
    const server = this.getServer(serverId);
    if (!server) return null;
    const variable = server.variables.find(v => v.id === variableId);
    return variable?.value ?? null;
  }

  // ── Settings (API keys, preferences) ───────────────────────────

  setSetting(key: string, value: string): void {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings[key] = this.encrypt(value);
    this.persist();
  }

  getSetting(key: string): string | null {
    const encrypted = this.data.settings?.[key];
    if (!encrypted) return null;
    try {
      return this.decrypt(encrypted);
    } catch {
      return null;
    }
  }

  deleteSetting(key: string): void {
    if (this.data.settings) {
      delete this.data.settings[key];
      this.persist();
    }
  }

  // ── Encryption ─────────────────────────────────────────────────

  encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv) as crypto.CipherGCM;
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(encryptedText: string): string {
    const buf = Buffer.from(encryptedText, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  // ── Private ────────────────────────────────────────────────────

  private encryptServer(server: ServerConnection): EncryptedServer {
    const s = { ...server };
    const sensitive: Record<string, string | undefined> = {};

    // Extract and encrypt sensitive fields
    if (s.authType === 'password' && s.password) {
      sensitive.password = s.password;
      delete s.password;
    }
    if (s.passphrase) {
      sensitive.passphrase = s.passphrase;
      delete s.passphrase;
    }
    if (s.jumpHost?.password) {
      sensitive.jumpHostPassword = s.jumpHost.password;
      s.jumpHost = { ...s.jumpHost };
      delete s.jumpHost.password;
    }

    // Encrypt variable values
    const encryptedVariables = s.variables.map(v => ({
      ...v,
      value: this.encrypt(v.value),
    }));

    return {
      ...s,
      variables: encryptedVariables,
      _sensitive: this.encrypt(JSON.stringify(sensitive)),
    };
  }

  private decryptServer(encrypted: EncryptedServer): ServerConnection {
    const { _sensitive, ...rest } = encrypted;
    const sensitive = JSON.parse(this.decrypt(_sensitive));

    const variables = rest.variables.map(v => ({
      ...v,
      value: this.decrypt(v.value),
    }));

    const result = { ...rest, ...sensitive, variables } as ServerConnection;

    // Restore jump host password from flattened sensitive storage
    if (sensitive.jumpHostPassword && result.jumpHost) {
      result.jumpHost = { ...result.jumpHost, password: sensitive.jumpHostPassword };
      delete (result as any).jumpHostPassword;
    }

    return result;
  }

  private validateServerSchema(server: any): void {
    if (!server.id || typeof server.id !== 'string') {
      throw new Error('Server missing valid id');
    }
    if (!server.name || typeof server.name !== 'string' || server.name.length > 255) {
      throw new Error(`Server "${server.id}" has invalid name`);
    }
    if (!server.host || typeof server.host !== 'string' || server.host.length > 255) {
      throw new Error(`Server "${server.id}" has invalid host`);
    }
    if (!server.username || typeof server.username !== 'string' || server.username.length > 128) {
      throw new Error(`Server "${server.id}" has invalid username`);
    }
    if (typeof server.port !== 'number' || server.port < 1 || server.port > 65535) {
      throw new Error(`Server "${server.id}" has invalid port`);
    }
    const validAuthTypes = ['password', 'key', 'jump-host'];
    if (!validAuthTypes.includes(server.authType)) {
      throw new Error(`Server "${server.id}" has invalid authType`);
    }
    if (server.variables && !Array.isArray(server.variables)) {
      throw new Error(`Server "${server.id}" has invalid variables`);
    }
  }

  /** Read raw vault JSON without decryption (used during construction to get salt). */
  private loadRaw(): VaultData | null {
    if (!fs.existsSync(this.vaultPath)) return null;
    try {
      // Ensure vault file has restrictive permissions (owner read/write only)
      if (process.platform !== 'win32') {
        const stat = fs.statSync(this.vaultPath);
        const mode = stat.mode & 0o777;
        if (mode !== 0o600) {
          fs.chmodSync(this.vaultPath, 0o600);
        }
      }
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private load(): VaultData {
    return this.loadRaw() ?? { servers: {}, version: 1 };
  }

  /** Atomic write: write to temp file first, then rename. */
  private persist(): void {
    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.vaultPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.vaultPath);
  }
}

interface EncryptedServer extends Omit<ServerConnection, 'passphrase'> {
  _sensitive: string;
}

interface VaultData {
  version: number;
  salt?: string; // base64-encoded random salt (generated per vault)
  servers: Record<string, EncryptedServer>;
  settings?: Record<string, string>;
}

interface ExportData {
  version: number;
  exportedAt: string;
  servers: ServerConnection[];
}
