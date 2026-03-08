import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NexTermVault } from '../vault/NexTermVault';
import { ServerConnection } from '../types';

describe('NexTermVault', () => {
  let vaultDir: string;
  let vault: NexTermVault;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-test-'));
    vault = new NexTermVault(vaultDir, 'test-master-password');
  });

  afterEach(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  function makeServer(overrides: Partial<ServerConnection> = {}): ServerConnection {
    return {
      id: 'srv-1',
      name: 'Test Server',
      host: '192.168.1.1',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'secret123',
      variables: [],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    };
  }

  // ── Encryption ────────────────────────────────────────────────

  describe('encrypt / decrypt', () => {
    it('should round-trip a string', () => {
      const original = 'hello-world-secret';
      const encrypted = vault.encrypt(original);
      expect(encrypted).not.toBe(original);
      expect(vault.decrypt(encrypted)).toBe(original);
    });

    it('should produce different ciphertext for the same plaintext (random IV)', () => {
      const text = 'same-text';
      const a = vault.encrypt(text);
      const b = vault.encrypt(text);
      expect(a).not.toBe(b);
    });

    it('should fail to decrypt with wrong password', () => {
      const encrypted = vault.encrypt('secret');
      const otherVault = new NexTermVault(vaultDir, 'wrong-password');
      expect(() => otherVault.decrypt(encrypted)).toThrow();
    });
  });

  // ── Server CRUD ───────────────────────────────────────────────

  describe('server CRUD', () => {
    it('should save and retrieve a server', () => {
      const server = makeServer();
      vault.saveServer(server);

      const retrieved = vault.getServer('srv-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Server');
      expect(retrieved!.host).toBe('192.168.1.1');
      expect(retrieved!.username).toBe('root');
      expect(retrieved!.password).toBe('secret123');
    });

    it('should return null for nonexistent server', () => {
      expect(vault.getServer('no-such-id')).toBeNull();
    });

    it('should list all servers', () => {
      vault.saveServer(makeServer({ id: 'a', name: 'A' }));
      vault.saveServer(makeServer({ id: 'b', name: 'B' }));

      const all = vault.getAllServers();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.name).sort()).toEqual(['A', 'B']);
    });

    it('should delete a server', () => {
      vault.saveServer(makeServer());
      vault.deleteServer('srv-1');
      expect(vault.getServer('srv-1')).toBeNull();
    });

    it('should update a server in place', () => {
      vault.saveServer(makeServer());
      vault.saveServer(makeServer({ name: 'Updated' }));

      const retrieved = vault.getServer('srv-1');
      expect(retrieved!.name).toBe('Updated');
      expect(vault.getAllServers()).toHaveLength(1);
    });
  });

  // ── Sensitive field encryption ────────────────────────────────

  describe('sensitive field encryption', () => {
    it('should not store password in plaintext on disk', () => {
      vault.saveServer(makeServer({ password: 'super-secret' }));

      const raw = fs.readFileSync(path.join(vaultDir, 'nexterm.vault'), 'utf8');
      expect(raw).not.toContain('super-secret');
    });

    it('should encrypt passphrase for key auth', () => {
      vault.saveServer(makeServer({
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'key-pass',
        password: undefined,
      }));

      const raw = fs.readFileSync(path.join(vaultDir, 'nexterm.vault'), 'utf8');
      expect(raw).not.toContain('key-pass');

      const retrieved = vault.getServer('srv-1');
      expect(retrieved!.passphrase).toBe('key-pass');
    });
  });

  // ── Variables ─────────────────────────────────────────────────

  describe('variables', () => {
    it('should encrypt variable values', () => {
      vault.saveServer(makeServer({
        variables: [{
          id: 'var-1',
          name: 'SUDO_PASSWORD',
          description: 'sudo password',
          value: 'sudo-secret',
          triggers: [{ pattern: '\\[sudo\\]', type: 'sudo' }],
        }],
      }));

      const raw = fs.readFileSync(path.join(vaultDir, 'nexterm.vault'), 'utf8');
      expect(raw).not.toContain('sudo-secret');

      const retrieved = vault.getServer('srv-1');
      expect(retrieved!.variables[0].value).toBe('sudo-secret');
    });

    it('should get variable value by id', () => {
      vault.saveServer(makeServer({
        variables: [{
          id: 'var-1',
          name: 'DB_PASS',
          description: 'db password',
          value: 'db123',
          triggers: [],
        }],
      }));

      expect(vault.getVariableValue('srv-1', 'var-1')).toBe('db123');
      expect(vault.getVariableValue('srv-1', 'no-var')).toBeNull();
      expect(vault.getVariableValue('no-srv', 'var-1')).toBeNull();
    });
  });

  // ── Export / Import ────────────────────────────────────────────

  describe('export / import', () => {
    it('should export servers to a file and import them back', () => {
      vault.saveServer(makeServer({ id: 'a', name: 'Alpha', password: 'pass-a' }));
      vault.saveServer(makeServer({ id: 'b', name: 'Beta', password: 'pass-b' }));

      const exportPath = path.join(vaultDir, 'backup.json');
      vault.exportServers(exportPath);

      expect(fs.existsSync(exportPath)).toBe(true);
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      expect(exported.servers).toHaveLength(2);
      expect(exported.version).toBe(1);
      expect(exported.exportedAt).toBeDefined();

      // Import into fresh vault
      const vault2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-import-'));
      const vault2 = new NexTermVault(vault2Dir, 'test-master-password');
      const result = vault2.importServers(exportPath, 'merge');

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(vault2.getServer('a')!.name).toBe('Alpha');
      // Passwords are stripped from exports for security
      expect(vault2.getServer('a')!.password).toBeUndefined();
      expect(vault2.getServer('b')!.name).toBe('Beta');

      fs.rmSync(vault2Dir, { recursive: true, force: true });
    });

    it('should skip existing servers in merge mode', () => {
      vault.saveServer(makeServer({ id: 'a', name: 'Original' }));

      const exportPath = path.join(vaultDir, 'backup.json');
      vault.exportServers(exportPath);

      const result = vault.importServers(exportPath, 'merge');
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(vault.getServer('a')!.name).toBe('Original');
    });

    it('should overwrite all servers in replace mode', () => {
      vault.saveServer(makeServer({ id: 'old', name: 'OldServer' }));

      // Create export with different server
      const vault2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-export-'));
      const vault2 = new NexTermVault(vault2Dir, 'test-master-password');
      vault2.saveServer(makeServer({ id: 'new', name: 'NewServer' }));
      const exportPath = path.join(vault2Dir, 'backup.json');
      vault2.exportServers(exportPath);

      const result = vault.importServers(exportPath, 'replace');
      expect(result.imported).toBe(1);
      expect(vault.getServer('old')).toBeNull();
      expect(vault.getServer('new')!.name).toBe('NewServer');

      fs.rmSync(vault2Dir, { recursive: true, force: true });
    });

    it('should set 0o600 permissions on export file', () => {
      vault.saveServer(makeServer());
      const exportPath = path.join(vaultDir, 'backup.json');
      vault.exportServers(exportPath);
      const stat = fs.statSync(exportPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  // ── Settings (API keys, preferences) ────────────────────────────

  describe('settings', () => {
    it('should store and retrieve a setting', () => {
      vault.setSetting('anthropic_api_key', 'sk-ant-test-123');
      expect(vault.getSetting('anthropic_api_key')).toBe('sk-ant-test-123');
    });

    it('should encrypt settings on disk', () => {
      vault.setSetting('secret_key', 'my-secret-value');
      const raw = fs.readFileSync(path.join(vaultDir, 'nexterm.vault'), 'utf8');
      expect(raw).not.toContain('my-secret-value');
    });

    it('should return null for nonexistent setting', () => {
      expect(vault.getSetting('no-such-key')).toBeNull();
    });

    it('should delete a setting', () => {
      vault.setSetting('temp', 'value');
      vault.deleteSetting('temp');
      expect(vault.getSetting('temp')).toBeNull();
    });

    it('should persist settings across instances', () => {
      vault.setSetting('key', 'persistent-value');
      const vault2 = new NexTermVault(vaultDir, 'test-master-password');
      expect(vault2.getSetting('key')).toBe('persistent-value');
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  describe('persistence', () => {
    it('should persist data across vault instances', () => {
      vault.saveServer(makeServer());

      const vault2 = new NexTermVault(vaultDir, 'test-master-password');
      const retrieved = vault2.getServer('srv-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.password).toBe('secret123');
    });

    it('should set file permissions to 0o600', () => {
      vault.saveServer(makeServer());
      const stat = fs.statSync(path.join(vaultDir, 'nexterm.vault'));
      // 0o600 = owner read/write only
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
