import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { SSHManager, NexTermVault, AutoFillEngine, ServerConnection, InteractiveClaudeSession } from '@nexterm/core';
import { ServerTreeProvider } from './ServerTreeProvider';
import { ServerFormPanel } from './panels/ServerFormPanel';
import { ClaudeChatPanel } from './panels/ClaudeChatPanel';

let vault: NexTermVault;
let sshManager: SSHManager;
let treeProvider: ServerTreeProvider;
let extensionUri: vscode.Uri;

// Track active connections and their Claude sessions
const activeConnections = new Set<string>();
const claudeSessions = new Map<string, InteractiveClaudeSession>();

export async function activate(context: vscode.ExtensionContext) {
  console.log('[NexTerm] Activating...');

  extensionUri = context.extensionUri;

  // Init vault with master password from OS keychain
  const vaultDir = path.join(os.homedir(), '.nexterm');
  const masterKey = await getMasterKey(context);
  vault = new NexTermVault(vaultDir, masterKey);
  sshManager = new SSHManager();
  treeProvider = new ServerTreeProvider(vault, activeConnections);

  // Register tree view
  vscode.window.registerTreeDataProvider('nexterm.servers', treeProvider);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('nexterm.addServer', () => addServerCommand()),
    vscode.commands.registerCommand('nexterm.connect', (item) => connectCommand(item)),
    vscode.commands.registerCommand('nexterm.editServer', (item) => editServerCommand(item)),
    vscode.commands.registerCommand('nexterm.deleteServer', (item) => deleteServerCommand(item)),
    vscode.commands.registerCommand('nexterm.claudeChat', (item) => claudeChatCommand(item)),
    vscode.commands.registerCommand('nexterm.setApiKey', () => setApiKeyCommand()),
  );

  console.log('[NexTerm] Ready!');
}

export function deactivate() {
  vault?.destroy();
  sshManager?.closeAll();
}

// ── Commands ────────────────────────────────────────────────────

async function connectCommand(item: { serverId: string }) {
  const server = vault.getServer(item.serverId);
  if (!server) return;

  // Open integrated terminal
  const terminal = vscode.window.createTerminal({
    name: `NexTerm: ${server.name}`,
    pty: createPty(server),
  });
  terminal.show();
}

function createPty(server: ServerConnection): vscode.Pseudoterminal {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<void>();
  let session: any;

  return {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    async open(dims) {
      writeEmitter.fire(`\x1b[36mNexTerm: Connecting to ${server.name} (${server.host})...\x1b[0m\r\n`);
      try {
        session = await sshManager.connect(server);
        const autofill = new AutoFillEngine();
        autofill.attach(session, server);

        // Attach Claude session for terminal context capture
        const claudeSession = claudeSessions.get(server.id);
        if (claudeSession) {
          claudeSession.attachToTerminal(session, server);
        }

        // Mark as connected
        activeConnections.add(server.id);
        treeProvider.refresh();

        session.on('data', (data: string) => {
          writeEmitter.fire(data.replace(/\n/g, '\r\n'));
        });
        session.on('close', () => {
          activeConnections.delete(server.id);
          claudeSessions.delete(server.id);
          treeProvider.refresh();
          closeEmitter.fire();
        });

        if (dims) session.resize(dims.columns, dims.rows);
      } catch (err: any) {
        writeEmitter.fire(`\x1b[31mConnection failed: ${err.message}\x1b[0m\r\n`);
        closeEmitter.fire();
      }
    },

    close() {
      if (session) {
        activeConnections.delete(server.id);
        treeProvider.refresh();
        session.close();
      }
    },

    handleInput(data: string) {
      session?.write(data);
    },

    setDimensions(dims) {
      session?.resize(dims.columns, dims.rows);
    },
  };
}

async function claudeChatCommand(item?: { serverId: string }) {
  // Get API key
  let apiKey: string | undefined = process.env.ANTHROPIC_API_KEY || vault.getSetting('anthropic_api_key') || undefined;
  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Anthropic API key',
      password: true,
      placeHolder: 'sk-ant-...',
    });
    if (!apiKey) return;

    const save = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'Save API key to vault?',
    });
    if (save === 'Yes') {
      vault.setSetting('anthropic_api_key', apiKey);
    }
  }

  // Create interactive session
  const claudeSession = new InteractiveClaudeSession({ apiKey });

  // If server context available, attach it
  let serverName: string | null = null;
  if (item?.serverId) {
    const server = vault.getServer(item.serverId);
    if (server) {
      claudeSession.setServerContext(server);
      claudeSessions.set(server.id, claudeSession);
      serverName = server.name;
    }
  }

  // Command execution callback — finds the matching terminal and sends the command
  const onRunCommand = serverName
    ? (command: string) => {
        const term = vscode.window.terminals.find(t => t.name === `NexTerm: ${serverName}`);
        if (term) {
          term.show();
          term.sendText(command);
        } else {
          vscode.window.showWarningMessage(
            `NexTerm: No active terminal for "${serverName}". Connect to the server first.`,
          );
        }
      }
    : undefined;

  // Open chat panel
  ClaudeChatPanel.open(extensionUri, claudeSession, serverName, onRunCommand);
}

async function setApiKeyCommand() {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your Anthropic API key',
    password: true,
    placeHolder: 'sk-ant-...',
  });
  if (!apiKey) return;

  vault.setSetting('anthropic_api_key', apiKey);
  vscode.window.showInformationMessage('NexTerm: API key saved.');
}

async function addServerCommand() {
  ServerFormPanel.open(extensionUri, null, (server) => {
    vault.saveServer(server);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`NexTerm: Server "${server.name}" saved!`);
  });
}

async function editServerCommand(item: { serverId: string }) {
  const server = vault.getServer(item.serverId);
  if (!server) return;

  ServerFormPanel.open(extensionUri, server, (updated) => {
    vault.saveServer(updated);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`NexTerm: Server "${updated.name}" updated!`);
  });
}

async function deleteServerCommand(item: { serverId: string }) {
  const server = vault.getServer(item.serverId);
  if (!server) return;
  const confirm = await vscode.window.showWarningMessage(
    `Delete server "${server.name}"?`, 'Delete', 'Cancel'
  );
  if (confirm === 'Delete') {
    vault.deleteServer(item.serverId);
    treeProvider.refresh();
  }
}

const MASTER_KEY_ID = 'nexterm.masterKey';

async function getMasterKey(context: vscode.ExtensionContext): Promise<string> {
  // Try OS keychain first (secure storage)
  let key = await context.secrets.get(MASTER_KEY_ID);
  if (key) return key;

  // Migration: try old deterministic key to re-encrypt existing vault
  const oldKey = `nexterm-${context.globalStorageUri.fsPath}`;
  const vaultDir = path.join(os.homedir(), '.nexterm');
  const vaultPath = path.join(vaultDir, 'nexterm.vault');
  const fs = await import('fs');

  if (fs.existsSync(vaultPath)) {
    // Existing vault — try migrating from old key
    try {
      const testVault = new NexTermVault(vaultDir, oldKey);
      // If constructor didn't throw, old key works. Generate new key and re-encrypt.
      key = crypto.randomBytes(32).toString('hex');
      await context.secrets.store(MASTER_KEY_ID, key);
      // Read all data with old key, then re-create vault with new key
      const servers = testVault.getAllServers();
      testVault.destroy();
      const newVault = new NexTermVault(vaultDir, key);
      for (const s of servers) newVault.saveServer(s);
      newVault.destroy();
      return key;
    } catch {
      // Old key didn't work, generate fresh
    }
  }

  // No existing vault or migration failed — generate new random key
  key = crypto.randomBytes(32).toString('hex');
  await context.secrets.store(MASTER_KEY_ID, key);
  return key;
}
