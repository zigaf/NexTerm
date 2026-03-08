import { DEFAULT_TRIGGERS, ServerConnection, PromptTrigger } from '../types';

describe('types', () => {
  describe('DEFAULT_TRIGGERS', () => {
    it('should have SUDO_PASSWORD triggers', () => {
      expect(DEFAULT_TRIGGERS.SUDO_PASSWORD).toBeDefined();
      expect(DEFAULT_TRIGGERS.SUDO_PASSWORD.length).toBeGreaterThan(0);
      expect(DEFAULT_TRIGGERS.SUDO_PASSWORD[0].type).toBe('sudo');
    });

    it('should have MYSQL_ROOT_PASSWORD triggers', () => {
      expect(DEFAULT_TRIGGERS.MYSQL_ROOT_PASSWORD).toBeDefined();
      expect(DEFAULT_TRIGGERS.MYSQL_ROOT_PASSWORD.length).toBeGreaterThan(0);
      expect(DEFAULT_TRIGGERS.MYSQL_ROOT_PASSWORD[0].type).toBe('mysql');
    });

    it('sudo patterns should match real sudo prompts', () => {
      const patterns = DEFAULT_TRIGGERS.SUDO_PASSWORD.map(t => new RegExp(t.pattern, 'i'));
      expect(patterns.some(p => p.test('[sudo] password for john:'))).toBe(true);
      expect(patterns.some(p => p.test('Password:'))).toBe(true);
    });

    it('mysql patterns should match real mysql prompts', () => {
      const patterns = DEFAULT_TRIGGERS.MYSQL_ROOT_PASSWORD.map(t => new RegExp(t.pattern, 'i'));
      expect(patterns.some(p => p.test('Enter password:'))).toBe(true);
    });
  });

  describe('ServerConnection interface', () => {
    it('should allow creating a valid server object', () => {
      const server: ServerConnection = {
        id: 'test-1',
        name: 'Test',
        host: '10.0.0.1',
        port: 22,
        username: 'admin',
        authType: 'password',
        password: 'pass123',
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(server.authType).toBe('password');
      expect(server.password).toBe('pass123');
    });

    it('should allow key auth with optional passphrase', () => {
      const server: ServerConnection = {
        id: 'test-2',
        name: 'Key Server',
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        authType: 'key',
        privateKeyPath: '/home/user/.ssh/id_rsa',
        passphrase: 'key-pass',
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(server.authType).toBe('key');
      expect(server.privateKeyPath).toBeDefined();
    });

    it('should allow jump-host config', () => {
      const server: ServerConnection = {
        id: 'test-3',
        name: 'Jump Server',
        host: '10.0.0.3',
        port: 22,
        username: 'admin',
        authType: 'jump-host',
        jumpHost: {
          host: '10.0.0.1',
          port: 22,
          username: 'bastion',
          authType: 'key',
          privateKeyPath: '/home/user/.ssh/jump_key',
        },
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(server.jumpHost).toBeDefined();
      expect(server.jumpHost!.host).toBe('10.0.0.1');
    });
  });
});
