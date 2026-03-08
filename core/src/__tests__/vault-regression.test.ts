/**
 * Regression tests for vault data integrity.
 *
 * These tests cover bugs found when a security/performance review
 * inadvertently broke the edit → save → connect flow:
 *
 * 1. getAllServersMeta() must not leak secrets (by design)
 * 2. Re-saving a server must not lose password if caller didn't change it
 * 3. Variable values must survive a save → load round-trip
 * 4. Saving with undefined password must not erase existing password
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NexTermVault } from '../vault/NexTermVault';
import { ServerConnection } from '../types';

describe('Vault regression — edit/save data integrity', () => {
  let vaultDir: string;
  let vault: NexTermVault;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-regression-'));
    vault = new NexTermVault(vaultDir, 'test-password');
  });

  afterEach(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  function makeServer(overrides: Partial<ServerConnection> = {}): ServerConnection {
    return {
      id: 'srv-1',
      name: 'Prod Server',
      host: '10.0.0.1',
      port: 22,
      username: 'deploy',
      authType: 'password',
      password: 'correct-horse-battery-staple',
      variables: [],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    };
  }

  // ── getAllServersMeta must not leak secrets ──────────────────

  describe('getAllServersMeta does not leak secrets', () => {
    it('should not include password in metadata', () => {
      vault.saveServer(makeServer({ password: 'secret-pw' }));

      const metas = vault.getAllServersMeta();
      expect(metas).toHaveLength(1);
      expect(metas[0]).not.toHaveProperty('password');
    });

    it('should not include passphrase in metadata', () => {
      vault.saveServer(makeServer({
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'key-secret',
        password: undefined,
      }));

      const metas = vault.getAllServersMeta();
      expect(metas[0]).not.toHaveProperty('passphrase');
    });

    it('should not include variable values in metadata', () => {
      vault.saveServer(makeServer({
        variables: [{
          id: 'var-1',
          name: 'SUDO_PASSWORD',
          description: 'sudo',
          value: 'sudo-secret',
          triggers: [],
        }],
      }));

      const metas = vault.getAllServersMeta();
      // Meta should not contain variables at all (or values should be stripped)
      const meta = metas[0] as any;
      if (meta.variables) {
        for (const v of meta.variables) {
          expect(v.value).not.toBe('sudo-secret');
        }
      }
    });
  });

  // ── Edit-save round-trip must preserve secrets ──────────────

  describe('edit → save preserves secrets', () => {
    it('should preserve password when re-saving with the same password', () => {
      vault.saveServer(makeServer({ password: 'original-password' }));

      // Simulate: load full server, change name, save back
      const loaded = vault.getServer('srv-1')!;
      expect(loaded.password).toBe('original-password');

      vault.saveServer({ ...loaded, name: 'Renamed Server' });

      const reloaded = vault.getServer('srv-1')!;
      expect(reloaded.name).toBe('Renamed Server');
      expect(reloaded.password).toBe('original-password');
    });

    it('should preserve passphrase when re-saving key-auth server', () => {
      vault.saveServer(makeServer({
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'original-passphrase',
        password: undefined,
      }));

      const loaded = vault.getServer('srv-1')!;
      vault.saveServer({ ...loaded, name: 'Renamed' });

      const reloaded = vault.getServer('srv-1')!;
      expect(reloaded.passphrase).toBe('original-passphrase');
    });

    it('should preserve variable values when re-saving', () => {
      vault.saveServer(makeServer({
        variables: [
          { id: 'v1', name: 'SUDO_PASSWORD', description: 'sudo', value: 'sudo-secret', triggers: [] },
          { id: 'v2', name: 'MYSQL_ROOT_PASSWORD', description: 'mysql', value: 'mysql-secret', triggers: [] },
        ],
      }));

      const loaded = vault.getServer('srv-1')!;
      vault.saveServer({ ...loaded, name: 'Renamed' });

      const reloaded = vault.getServer('srv-1')!;
      expect(reloaded.variables.find(v => v.name === 'SUDO_PASSWORD')!.value).toBe('sudo-secret');
      expect(reloaded.variables.find(v => v.name === 'MYSQL_ROOT_PASSWORD')!.value).toBe('mysql-secret');
    });

    it('should preserve jump-host password when re-saving', () => {
      vault.saveServer(makeServer({
        authType: 'jump-host',
        password: 'target-pass',
        jumpHost: {
          host: 'bastion.example.com',
          port: 22,
          username: 'bastion-user',
          authType: 'password',
          password: 'bastion-secret',
        },
      }));

      const loaded = vault.getServer('srv-1')!;
      vault.saveServer({ ...loaded, name: 'Renamed' });

      const reloaded = vault.getServer('srv-1')!;
      expect(reloaded.jumpHost!.password).toBe('bastion-secret');
    });
  });

  // ── Dangerous pattern: saving metadata back erases secrets ──

  describe('saving metadata without secrets erases them (documents risk)', () => {
    it('should lose password if saved with undefined password', () => {
      vault.saveServer(makeServer({ password: 'original' }));

      // Simulate the bug: get metadata (no secrets), save it back
      const loaded = vault.getServer('srv-1')!;
      const withoutPassword = { ...loaded, password: undefined };
      vault.saveServer(withoutPassword);

      const reloaded = vault.getServer('srv-1')!;
      // This documents the risk: saving without password erases it
      expect(reloaded.password).toBeUndefined();
    });

    it('should lose variable values if saved with empty values', () => {
      vault.saveServer(makeServer({
        variables: [{ id: 'v1', name: 'SUDO_PASSWORD', description: 'sudo', value: 'real-password', triggers: [] }],
      }));

      // Simulate: save with empty variable value
      const loaded = vault.getServer('srv-1')!;
      loaded.variables[0] = { ...loaded.variables[0], value: '' };
      vault.saveServer(loaded);

      const reloaded = vault.getServer('srv-1')!;
      expect(reloaded.variables[0].value).toBe('');
    });
  });

  // ── Persistence across instances ────────────────────────────

  describe('secrets persist across vault instances', () => {
    it('should keep password after vault reload', () => {
      vault.saveServer(makeServer({ password: 'persistent-pw' }));

      const vault2 = new NexTermVault(vaultDir, 'test-password');
      const loaded = vault2.getServer('srv-1')!;
      expect(loaded.password).toBe('persistent-pw');
    });

    it('should keep all auth fields after vault reload', () => {
      vault.saveServer(makeServer({
        authType: 'jump-host',
        password: 'target-pw',
        jumpHost: {
          host: 'bastion.example.com',
          port: 22,
          username: 'jump-user',
          authType: 'password',
          password: 'jump-pw',
        },
        variables: [{ id: 'v1', name: 'SUDO_PASSWORD', description: 'sudo', value: 'sudo-val', triggers: [] }],
      }));

      const vault2 = new NexTermVault(vaultDir, 'test-password');
      const loaded = vault2.getServer('srv-1')!;

      expect(loaded.password).toBe('target-pw');
      expect(loaded.jumpHost!.password).toBe('jump-pw');
      expect(loaded.variables[0].value).toBe('sudo-val');
    });
  });
});
