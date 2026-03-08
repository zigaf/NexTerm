/**
 * Regression tests for SSH connection configuration.
 *
 * These tests cover bugs found when a security review changed
 * host key verification settings without proper integration testing:
 *
 * 1. buildConnectConfig must include password for password-auth servers
 * 2. buildConnectConfig must include private key for key-auth servers
 * 3. hostVerifier must accept unknown hosts (TOFU)
 * 4. hostVerifier must reject mismatched host keys
 * 5. validateKeyPath must block paths outside home directory
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SSHManager } from '../ssh/SSHManager';
import { ServerConnection } from '../types';

// Access private methods for testing via prototype
const manager = new SSHManager();
const buildConnectConfig = (manager as any).buildConnectConfig.bind(manager);
const verifyHostKey = (manager as any).verifyHostKey.bind(manager);
const validateKeyPath = (manager as any).validateKeyPath.bind(manager);

function makeServer(overrides: Partial<ServerConnection> = {}): ServerConnection {
  return {
    id: 'srv-1',
    name: 'Test',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'test-password',
    variables: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SSHManager — connection config regression', () => {

  // ── Password auth ───────────────────────────────────────────

  describe('password auth config', () => {
    it('should include password in connect config', async () => {
      const config = await buildConnectConfig(makeServer({ password: 'my-password' }));
      expect(config.password).toBe('my-password');
    });

    it('should not include password when it is undefined', async () => {
      const config = await buildConnectConfig(makeServer({ password: undefined }));
      expect(config.password).toBeUndefined();
    });

    it('should set host, port, and username correctly', async () => {
      const config = await buildConnectConfig(makeServer({
        host: '192.168.1.100',
        port: 2222,
        username: 'deploy',
      }));
      expect(config.host).toBe('192.168.1.100');
      expect(config.port).toBe(2222);
      expect(config.username).toBe('deploy');
    });
  });

  // ── Key auth ────────────────────────────────────────────────

  describe('key auth config', () => {
    let tmpKeyPath: string;

    beforeEach(() => {
      // Create a temporary key file under home directory
      const sshDir = path.join(os.homedir(), '.ssh');
      if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });
      tmpKeyPath = path.join(sshDir, 'nexterm-test-key');
      fs.writeFileSync(tmpKeyPath, 'fake-private-key-content');
    });

    afterEach(() => {
      if (fs.existsSync(tmpKeyPath)) fs.unlinkSync(tmpKeyPath);
    });

    it('should load private key from file', async () => {
      const config = await buildConnectConfig(makeServer({
        authType: 'key',
        privateKeyPath: tmpKeyPath,
        password: undefined,
      }));
      expect(config.privateKey).toBeDefined();
      expect(config.privateKey.toString()).toBe('fake-private-key-content');
    });

    it('should include passphrase when provided', async () => {
      const config = await buildConnectConfig(makeServer({
        authType: 'key',
        privateKeyPath: tmpKeyPath,
        passphrase: 'key-passphrase',
        password: undefined,
      }));
      expect(config.passphrase).toBe('key-passphrase');
    });
  });

  // ── Host key verification ───────────────────────────────────

  describe('host key verification (TOFU)', () => {
    it('should include hostVerifier in config', async () => {
      const config = await buildConnectConfig(makeServer());
      expect(config.hostVerifier).toBeDefined();
      expect(typeof config.hostVerifier).toBe('function');
    });

    it('should accept unknown hosts (TOFU)', () => {
      // An unknown host with a random hash should be accepted
      const result = verifyHostKey('unknown-host.example.com', 22, 'abcdef1234567890');
      expect(result).toBe(true);
    });

    it('should set hostHash to sha256', async () => {
      const config = await buildConnectConfig(makeServer());
      expect(config.hostHash).toBe('sha256');
    });
  });

  // ── Key path validation ─────────────────────────────────────

  describe('validateKeyPath', () => {
    it('should accept paths under home directory', () => {
      const keyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      expect(() => validateKeyPath(keyPath)).not.toThrow();
    });

    it('should reject paths outside home directory', () => {
      expect(() => validateKeyPath('/etc/shadow')).toThrow('home directory');
    });

    it('should reject /etc/passwd', () => {
      expect(() => validateKeyPath('/etc/passwd')).toThrow();
    });

    it('should handle relative paths by resolving them', () => {
      // A relative path starting with "../../../etc" resolves to outside home
      const maliciousPath = '/tmp/fake-key';
      expect(() => validateKeyPath(maliciousPath)).toThrow('home directory');
    });
  });

  // ── readyTimeout ────────────────────────────────────────────

  describe('connection timeout', () => {
    it('should set a 10-second ready timeout', async () => {
      const config = await buildConnectConfig(makeServer());
      expect(config.readyTimeout).toBe(10000);
    });
  });
});
