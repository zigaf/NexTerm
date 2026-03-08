import { Client, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ServerConnection, ConnectionSession } from '../types';
import { EventEmitter } from 'events';

export interface SSHSession extends EventEmitter {
  id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export class SSHManager {
  private sessions = new Map<string, { client: Client; stream: any }>();

  /**
   * Connect to a server and return an SSHSession.
   * Emits: 'data' (terminal output), 'close', 'error'
   */
  async connect(server: ServerConnection): Promise<SSHSession> {
    const client = new Client();
    const emitter = new EventEmitter() as SSHSession;
    const sessionId = `${server.id}-${Date.now()}`;

    const config = await this.buildConnectConfig(server);

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        client.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

          this.sessions.set(sessionId, { client, stream });

          stream.on('data', (data: Buffer) => emitter.emit('data', data.toString()));
          stream.stderr.on('data', (data: Buffer) => emitter.emit('data', data.toString()));
          stream.on('close', () => {
            this.sessions.delete(sessionId);
            emitter.emit('close');
            client.end();
          });

          // Attach control methods
          emitter.id = sessionId;
          emitter.write = (text: string) => stream.write(text);
          emitter.resize = (cols: number, rows: number) => stream.setWindow(rows, cols, 0, 0);
          emitter.close = () => { stream.close(); client.end(); };

          resolve(emitter);
        });
      });

      client.on('error', (err) => reject(err));

      // Handle jump-host
      if (server.authType === 'jump-host' && server.jumpHost) {
        this.connectViaJumpHost(client, config, server);
      } else {
        client.connect(config);
      }
    });
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  closeAll() {
    for (const { client } of this.sessions.values()) {
      client.end();
    }
    this.sessions.clear();
  }

  // ── Private ────────────────────────────────────────────────────

  private async buildConnectConfig(server: ServerConnection): Promise<ConnectConfig> {
    const base: ConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: 10000,
    };

    if (server.authType === 'key' && server.privateKeyPath) {
      this.validateKeyPath(server.privateKeyPath);
      base.privateKey = await fs.promises.readFile(server.privateKeyPath);
      if (server.passphrase) base.passphrase = server.passphrase;
    } else if (server.password) {
      base.password = server.password;
    }

    // Host key verification (TOFU — Trust On First Use)
    const host = server.host;
    const port = server.port;
    base.hostHash = 'sha256';
    base.hostVerifier = (hashedKey: Buffer) => {
      return this.verifyHostKey(host, port, hashedKey.toString('hex'));
    };

    return base;
  }

  private connectViaJumpHost(targetClient: Client, targetConfig: ConnectConfig, server: ServerConnection) {
    const jump = server.jumpHost!;
    const jumpClient = new Client();

    const jumpConfig: ConnectConfig = {
      host: jump.host,
      port: jump.port,
      username: jump.username,
    };

    if (jump.authType === 'key' && jump.privateKeyPath) {
      this.validateKeyPath(jump.privateKeyPath);
      jumpConfig.privateKey = fs.readFileSync(jump.privateKeyPath);
    } else if (jump.authType === 'password' && jump.password) {
      jumpConfig.password = jump.password;
    }

    // Host key verification for jump host (same TOFU as target)
    jumpConfig.hostHash = 'sha256';
    jumpConfig.hostVerifier = (hashedKey: Buffer) => {
      return this.verifyHostKey(jump.host, jump.port, hashedKey.toString('hex'));
    };

    jumpClient.on('ready', () => {
      jumpClient.forwardOut('127.0.0.1', 0, server.host, server.port, (err, stream) => {
        if (err) {
          jumpClient.end();
          targetClient.emit('error', err);
          return;
        }
        targetClient.connect({ ...targetConfig, sock: stream });
      });
    });

    jumpClient.on('error', (err) => {
      targetClient.emit('error', err);
    });

    jumpClient.connect(jumpConfig);
  }

  /**
   * Verify SSH host key against ~/.ssh/known_hosts (TOFU).
   * Returns true if key is known/new, false if mismatched.
   */
  private verifyHostKey(host: string, port: number, hashedKey: string): boolean {
    const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts');
    const entry = port === 22 ? host : `[${host}]:${port}`;

    try {
      if (fs.existsSync(knownHostsPath)) {
        const content = fs.readFileSync(knownHostsPath, 'utf8');
        const lines = content.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const parts = trimmed.split(/\s+/);
          if (parts.length < 3) continue;

          const hosts = parts[0].split(',');
          if (hosts.includes(entry) || hosts.includes(host)) {
            // Host found — compare key fingerprint
            const storedKey = parts[2];
            const storedHash = crypto.createHash('sha256').update(Buffer.from(storedKey, 'base64')).digest('hex');
            if (storedHash === hashedKey) {
              return true; // Key matches
            }
            // Key mismatch — reject (possible MITM)
            return false;
          }
        }
      }
    } catch {
      // If we can't read known_hosts, fall through to TOFU
    }

    // Unknown host — accept (TOFU) and try to save
    // Don't fail the connection if we can't write
    try {
      const sshDir = path.join(os.homedir(), '.ssh');
      if (!fs.existsSync(sshDir)) {
        fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
      }
      // We don't have the raw key here (only hash), so we can't append to known_hosts
      // The user should verify via an out-of-band mechanism
    } catch {
      // Ignore write errors
    }

    return true; // TOFU — accept unknown hosts
  }

  /** Validate that privateKeyPath is safe to read */
  private validateKeyPath(keyPath: string): void {
    const resolved = path.resolve(keyPath);
    const home = os.homedir();

    if (!resolved.startsWith(home)) {
      throw new Error(`Private key path must be under home directory: ${resolved}`);
    }

    const blocked = ['/etc/shadow', '/etc/passwd', '/etc/master.passwd'];
    if (blocked.includes(resolved)) {
      throw new Error(`Access to ${resolved} is not allowed`);
    }
  }
}
