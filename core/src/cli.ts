#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { NexTermVault } from './vault/NexTermVault';
import { SSHManager } from './ssh/SSHManager';
import { AutoFillEngine } from './autofill/AutoFillEngine';
import { ClaudeAssistant } from './anthropic/ClaudeAssistant';
import { InteractiveClaudeSession, CLAUDE_MODELS, ClaudeModelAlias } from './anthropic/InteractiveSession';
import { ServerConnection } from './types';

const VAULT_DIR = path.join(os.homedir(), '.nexterm');

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function promptPassword(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Note: password masking would require raw mode; keeping simple for portability
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

async function getMasterPassword(): Promise<string> {
  const envKey = process.env.NEXTERM_MASTER_PASSWORD;
  if (envKey) return envKey;
  return promptPassword('Master password: ');
}

// ── Commands ────────────────────────────────────────────────────

async function listServers(vault: NexTermVault) {
  const servers = vault.getAllServers();
  if (servers.length === 0) {
    console.log('No servers saved. Use "nexterm-cli add" to add one.');
    return;
  }
  console.log('\nSaved servers:\n');
  for (const s of servers) {
    const vars = s.variables.length > 0 ? ` [${s.variables.length} var(s)]` : '';
    console.log(`  ${s.id}  ${s.name}  ${s.username}@${s.host}:${s.port}  (${s.authType})${vars}`);
  }
  console.log();
}

async function addServer(vault: NexTermVault) {
  const name = await prompt('Server name: ');
  const host = await prompt('Host / IP: ');
  const portStr = await prompt('Port [22]: ');
  const port = portStr ? parseInt(portStr, 10) : 22;
  const username = await prompt('Username: ');
  const authType = await prompt('Auth type (password / key / jump-host) [password]: ') || 'password';

  const server: ServerConnection = {
    id: `server-${Date.now()}`,
    name,
    host,
    port,
    username,
    authType: authType as ServerConnection['authType'],
    variables: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (authType === 'password') {
    server.password = await promptPassword('SSH Password: ');
  } else if (authType === 'key') {
    server.privateKeyPath = await prompt(`Key path [${os.homedir()}/.ssh/id_rsa]: `) || path.join(os.homedir(), '.ssh', 'id_rsa');
    const pp = await promptPassword('Key passphrase (enter to skip): ');
    if (pp) server.passphrase = pp;
  }

  // Optional: sudo password variable
  const sudoPass = await promptPassword('Sudo password (enter to skip): ');
  if (sudoPass) {
    server.variables.push({
      id: `var-${Date.now()}`,
      name: 'SUDO_PASSWORD',
      description: 'sudo password',
      value: sudoPass,
      triggers: [],
    });
  }

  vault.saveServer(server);
  console.log(`\nServer "${name}" saved (id: ${server.id})`);
}

async function connectToServer(vault: NexTermVault, serverId?: string) {
  if (!serverId) {
    const servers = vault.getAllServers();
    if (servers.length === 0) {
      console.log('No servers. Use "nexterm-cli add" first.');
      return;
    }
    console.log('\nAvailable servers:');
    servers.forEach((s, i) => console.log(`  [${i}] ${s.name}  ${s.username}@${s.host}:${s.port}`));
    const idx = await prompt('\nSelect server number: ');
    const server = servers[parseInt(idx, 10)];
    if (!server) { console.log('Invalid selection.'); return; }
    serverId = server.id;
  }

  const server = vault.getServer(serverId);
  if (!server) { console.log(`Server "${serverId}" not found.`); return; }

  console.log(`\nConnecting to ${server.name} (${server.username}@${server.host}:${server.port})...\n`);

  const sshManager = new SSHManager();
  const autofill = new AutoFillEngine();

  try {
    const session = await sshManager.connect(server);
    autofill.attach(session, server);

    // Pipe SSH output to stdout
    session.on('data', (data: string) => process.stdout.write(data));
    session.on('close', () => {
      console.log('\n[NexTerm] Connection closed.');
      process.exit(0);
    });

    // Enter raw mode for interactive terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => session.write(data.toString()));

    // Handle terminal resize
    process.stdout.on('resize', () => {
      session.resize(process.stdout.columns || 80, process.stdout.rows || 24);
    });
    session.resize(process.stdout.columns || 80, process.stdout.rows || 24);

    // Graceful shutdown
    process.on('SIGINT', () => { session.close(); });
  } catch (err: any) {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  }
}

async function deleteServer(vault: NexTermVault, serverId?: string) {
  if (!serverId) {
    const servers = vault.getAllServers();
    if (servers.length === 0) { console.log('No servers.'); return; }
    servers.forEach((s, i) => console.log(`  [${i}] ${s.name}  ${s.username}@${s.host}:${s.port}`));
    const idx = await prompt('\nSelect server to delete: ');
    const server = servers[parseInt(idx, 10)];
    if (!server) { console.log('Invalid selection.'); return; }
    serverId = server.id;
  }

  const server = vault.getServer(serverId);
  if (!server) { console.log(`Server "${serverId}" not found.`); return; }

  const confirm = await prompt(`Delete "${server.name}"? (y/N): `);
  if (confirm.toLowerCase() === 'y') {
    vault.deleteServer(serverId);
    console.log(`Deleted "${server.name}".`);
  } else {
    console.log('Cancelled.');
  }
}

async function exportServers(vault: NexTermVault, filePath?: string) {
  if (!filePath) {
    filePath = `nexterm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  }
  vault.exportServers(filePath);
  console.log(`Exported ${vault.getAllServers().length} server(s) to ${filePath}`);
}

async function importServers(vault: NexTermVault, filePath?: string) {
  if (!filePath) {
    filePath = await prompt('Path to backup file: ');
  }
  if (!filePath || !fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  const mode = (await prompt('Import mode — merge (skip existing) or replace (overwrite all)? [merge]: ') || 'merge') as 'merge' | 'replace';
  const result = vault.importServers(filePath, mode);
  console.log(`Imported ${result.imported} server(s), skipped ${result.skipped}.`);
}

async function diagnoseCommand(vault: NexTermVault, serverId?: string) {
  const errorText = await prompt('Paste the terminal output / error:\n');
  if (!errorText) { console.log('No input.'); return; }

  const server = serverId ? vault.getServer(serverId) : null;
  const serverCtx = server ?? { name: 'unknown', host: 'unknown', username: 'unknown' };

  const claude = new ClaudeAssistant();
  console.log('\nAnalyzing...\n');
  const result = await claude.diagnoseError(errorText, serverCtx);

  console.log(`Error:  ${result.error}`);
  console.log(`Cause:  ${result.cause}`);
  console.log(`Fix:    ${result.fix}`);
  if (result.commands.length > 0) {
    console.log('\nSuggested commands:');
    result.commands.forEach(c => console.log(`  $ ${c}`));
  }
}

async function suggestCommand(vault: NexTermVault, serverId?: string) {
  const context = await prompt('What are you trying to do?\n');
  if (!context) { console.log('No input.'); return; }

  const server = serverId ? vault.getServer(serverId) : null;
  const serverCtx = server ?? { name: 'unknown', host: 'unknown', username: 'unknown' };

  const claude = new ClaudeAssistant();
  console.log('\nThinking...\n');
  const suggestions = await claude.suggestCommands(context, serverCtx);

  if (suggestions.length === 0) {
    console.log('No suggestions.');
    return;
  }
  suggestions.forEach(s => {
    const risk = s.risk === 'dangerous' ? ' [DANGEROUS]' : s.risk === 'moderate' ? ' [moderate]' : '';
    console.log(`  $ ${s.command}${risk}`);
    console.log(`    ${s.description}\n`);
  });
}

async function claudeChat(vault: NexTermVault, serverId?: string) {
  // Resolve API key: env > vault setting
  let apiKey = process.env.ANTHROPIC_API_KEY || vault.getSetting('anthropic_api_key');
  if (!apiKey) {
    apiKey = await prompt('Anthropic API key: ');
    if (!apiKey) { console.log('No API key provided.'); return; }
    const save = await prompt('Save key to vault? (y/N): ');
    if (save.toLowerCase() === 'y') {
      vault.setSetting('anthropic_api_key', apiKey);
      console.log('API key saved to vault.\n');
    }
  }

  // Pick model
  const modelInput = await prompt('Model — haiku / sonnet / opus [sonnet]: ') || 'sonnet';
  const modelAlias = (['haiku', 'sonnet', 'opus'].includes(modelInput) ? modelInput : 'sonnet') as ClaudeModelAlias;

  const session = new InteractiveClaudeSession({ apiKey, model: modelAlias });

  // Optional: connect to server for terminal context
  if (serverId) {
    const server = vault.getServer(serverId);
    if (server) {
      session.setServerContext(server);
      console.log(`Server context: ${server.name} (${server.username}@${server.host})`);
    }
  }

  console.log(`\nClaude (${modelAlias}) ready. Type your message. Commands: /model, /clear, /exit\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const askLoop = (): void => {
    rl.question('\x1b[36myou>\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { askLoop(); return; }

      // Meta commands
      if (trimmed === '/exit' || trimmed === '/quit') {
        rl.close();
        return;
      }
      if (trimmed === '/clear') {
        session.clearHistory();
        console.log('History cleared.\n');
        askLoop();
        return;
      }
      if (trimmed.startsWith('/model')) {
        const newModel = trimmed.split(/\s+/)[1] as ClaudeModelAlias | undefined;
        if (newModel && ['haiku', 'sonnet', 'opus'].includes(newModel)) {
          session.setModel(newModel);
          console.log(`Switched to ${newModel}.\n`);
        } else {
          console.log(`Current: ${session.getModel()}. Usage: /model haiku|sonnet|opus\n`);
        }
        askLoop();
        return;
      }

      // Chat with streaming
      process.stdout.write('\x1b[33mclaude>\x1b[0m ');
      try {
        for await (const chunk of session.chat(trimmed)) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n\n');
      } catch (err: any) {
        console.error(`\n\x1b[31mError: ${err.message}\x1b[0m\n`);
      }

      askLoop();
    });
  };

  askLoop();

  // Keep alive until /exit
  return new Promise<void>(resolve => rl.on('close', resolve));
}

async function setApiKey(vault: NexTermVault) {
  const key = await prompt('Anthropic API key: ');
  if (!key) { console.log('No key provided.'); return; }
  vault.setSetting('anthropic_api_key', key);
  console.log('API key saved to vault.');
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help') {
    console.log(`
NexTerm CLI — SSH Manager

Usage:
  nexterm-cli list                List saved servers
  nexterm-cli add                 Add a new server
  nexterm-cli connect [id]        Connect to a server (interactive)
  nexterm-cli delete [id]         Delete a server
  nexterm-cli export [file]       Export servers to JSON backup
  nexterm-cli import [file]       Import servers from JSON backup
  nexterm-cli claude [id]          Interactive Claude chat session
  nexterm-cli diagnose [id]       AI-diagnose a terminal error
  nexterm-cli suggest [id]        AI-suggest commands for a task
  nexterm-cli set-api-key         Save Anthropic API key to vault
  nexterm-cli help                Show this help

Environment:
  NEXTERM_MASTER_PASSWORD         Master password (skip prompt)
  ANTHROPIC_API_KEY               API key for Claude AI features
`);
    return;
  }

  const masterPassword = await getMasterPassword();
  const vault = new NexTermVault(VAULT_DIR, masterPassword);

  switch (command) {
    case 'list': await listServers(vault); break;
    case 'add': await addServer(vault); break;
    case 'connect': await connectToServer(vault, args[1]); break;
    case 'delete': await deleteServer(vault, args[1]); break;
    case 'export': await exportServers(vault, args[1]); break;
    case 'import': await importServers(vault, args[1]); break;
    case 'diagnose': await diagnoseCommand(vault, args[1]); break;
    case 'suggest': await suggestCommand(vault, args[1]); break;
    case 'claude': await claudeChat(vault, args[1]); break;
    case 'set-api-key': await setApiKey(vault); break;
    default:
      console.log(`Unknown command: "${command}". Run "nexterm-cli help" for usage.`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
