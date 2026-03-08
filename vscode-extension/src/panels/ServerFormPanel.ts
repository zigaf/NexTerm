import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ServerConnection, ServerVariable, PromptTrigger, DEFAULT_TRIGGERS } from '@nexterm/core';

export class ServerFormPanel {
  private static panels = new Map<string, ServerFormPanel>();
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private server: ServerConnection | null,
    private onSave: (server: ServerConnection) => void,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static open(
    extensionUri: vscode.Uri,
    server: ServerConnection | null,
    onSave: (server: ServerConnection) => void,
  ) {
    const id = server?.id ?? '__new__';
    const existing = ServerFormPanel.panels.get(id);
    if (existing) {
      existing.panel.reveal();
      return;
    }

    const title = server ? `Edit: ${server.name}` : 'Add Server';
    const panel = vscode.window.createWebviewPanel(
      'nexterm.serverForm',
      title,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    const instance = new ServerFormPanel(panel, server, onSave);
    ServerFormPanel.panels.set(id, instance);
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'save': {
        const data = msg.data;
        const server: ServerConnection = {
          id: this.server?.id ?? `server-${Date.now()}`,
          name: data.name,
          host: data.host,
          port: parseInt(data.port, 10) || 22,
          username: data.username,
          authType: data.authType,
          password: data.authType === 'password' ? data.password : undefined,
          privateKeyPath: data.authType === 'key' ? data.privateKeyPath : undefined,
          passphrase: data.authType === 'key' ? data.passphrase : undefined,
          jumpHost: data.authType === 'jump-host' ? {
            host: data.jumpHost,
            port: parseInt(data.jumpPort, 10) || 22,
            username: data.jumpUsername,
            authType: data.jumpAuthType || 'password',
            password: data.jumpPassword,
            privateKeyPath: data.jumpKeyPath,
          } : undefined,
          variables: data.variables || [],
          createdAt: this.server?.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        this.onSave(server);
        this.panel.dispose();
        break;
      }
      case 'cancel':
        this.panel.dispose();
        break;
    }
  }

  private dispose() {
    const id = this.server?.id ?? '__new__';
    ServerFormPanel.panels.delete(id);
    this.disposables.forEach(d => d.dispose());
  }

  private getHtml(): string {
    const s = this.server;
    const varsJson = JSON.stringify(s?.variables ?? []);
    const defaultTriggersJson = JSON.stringify(DEFAULT_TRIGGERS);
    const nonce = crypto.randomBytes(16).toString('base64');

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, #3c3c3c);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --btn-sec-bg: var(--vscode-button-secondaryBackground);
    --btn-sec-fg: var(--vscode-button-secondaryForeground);
    --border: var(--vscode-panel-border, #3c3c3c);
    --danger: var(--vscode-errorForeground, #f44747);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 20px; max-width: 600px; }
  h2 { margin-bottom: 16px; font-size: 16px; font-weight: 600; }
  h3 { margin: 20px 0 10px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  label { display: block; margin-bottom: 4px; font-size: 12px; opacity: 0.85; }
  input, select {
    width: 100%; padding: 6px 8px; margin-bottom: 12px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    font-size: 13px; font-family: inherit;
  }
  input:focus, select:focus { outline: 1px solid var(--btn-bg); border-color: var(--btn-bg); }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .row > div.small { flex: 0 0 100px; }
  .btn {
    padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer;
    font-size: 13px; font-family: inherit;
  }
  .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
  .btn-primary:hover { background: var(--btn-hover); }
  .btn-secondary { background: var(--btn-sec-bg); color: var(--btn-sec-fg); }
  .btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .btn-sm { padding: 3px 8px; font-size: 12px; }
  .actions { display: flex; gap: 8px; margin-top: 20px; }
  .hidden { display: none !important; }
  .var-item {
    background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 10px; margin-bottom: 8px;
  }
  .var-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .var-header strong { font-size: 13px; }
  .trigger-list { font-size: 11px; opacity: 0.7; margin-top: 4px; }
</style>
</head>
<body>

<h2>${s ? 'Edit Server' : 'Add Server'}</h2>

<label>Name</label>
<input id="name" value="${esc(s?.name)}" placeholder="My Production Server" />

<div class="row">
  <div><label>Host / IP</label><input id="host" value="${esc(s?.host)}" placeholder="192.168.1.1" /></div>
  <div class="small"><label>Port</label><input id="port" type="number" value="${s?.port ?? 22}" /></div>
</div>

<label>Username</label>
<input id="username" value="${esc(s?.username)}" placeholder="root" />

<label>Auth Type</label>
<select id="authType" onchange="toggleAuth()">
  <option value="password" ${s?.authType === 'password' ? 'selected' : ''}>Password</option>
  <option value="key" ${s?.authType === 'key' ? 'selected' : ''}>SSH Key</option>
  <option value="jump-host" ${s?.authType === 'jump-host' ? 'selected' : ''}>Jump Host</option>
</select>

<div id="auth-password" class="${s?.authType !== 'key' && s?.authType !== 'jump-host' ? '' : 'hidden'}">
  <label>Password</label>
  <input id="password" type="password" value="${esc(s?.password)}" placeholder="SSH password" />
</div>

<div id="auth-key" class="${s?.authType === 'key' ? '' : 'hidden'}">
  <label>Private Key Path</label>
  <input id="privateKeyPath" value="${esc(s?.privateKeyPath)}" placeholder="~/.ssh/id_rsa" />
  <label>Passphrase (optional)</label>
  <input id="passphrase" type="password" value="${esc(s?.passphrase)}" />
</div>

<div id="auth-jump" class="${s?.authType === 'jump-host' ? '' : 'hidden'}">
  <h3>Jump Host</h3>
  <div class="row">
    <div><label>Host</label><input id="jumpHost" value="${esc(s?.jumpHost?.host)}" /></div>
    <div class="small"><label>Port</label><input id="jumpPort" type="number" value="${s?.jumpHost?.port ?? 22}" /></div>
  </div>
  <label>Username</label>
  <input id="jumpUsername" value="${esc(s?.jumpHost?.username)}" />
  <label>Auth Type</label>
  <select id="jumpAuthType">
    <option value="password" ${s?.jumpHost?.authType !== 'key' ? 'selected' : ''}>Password</option>
    <option value="key" ${s?.jumpHost?.authType === 'key' ? 'selected' : ''}>SSH Key</option>
  </select>
  <label>Password / Key Path</label>
  <input id="jumpPassword" type="password" value="${esc(s?.jumpHost?.password)}" placeholder="Password or key path" />
  <input id="jumpKeyPath" value="${esc(s?.jumpHost?.privateKeyPath)}" placeholder="~/.ssh/jump_key" class="hidden" />
</div>

<h3>Variables</h3>
<div id="variables"></div>
<button class="btn btn-secondary btn-sm" onclick="addVariable()">+ Add Variable</button>

<div class="actions">
  <button class="btn btn-primary" onclick="save()">Save</button>
  <button class="btn btn-secondary" onclick="cancel()">Cancel</button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let variables = ${varsJson};
const defaultTriggers = ${defaultTriggersJson};

function toggleAuth() {
  const t = document.getElementById('authType').value;
  document.getElementById('auth-password').className = t === 'password' ? '' : 'hidden';
  document.getElementById('auth-key').className = t === 'key' ? '' : 'hidden';
  document.getElementById('auth-jump').className = t === 'jump-host' ? '' : 'hidden';
}

function renderVariables() {
  const container = document.getElementById('variables');
  container.innerHTML = '';
  variables.forEach((v, i) => {
    const triggers = v.triggers.length > 0
      ? v.triggers.map(t => t.pattern).join(', ')
      : (defaultTriggers[v.name] ? 'default triggers' : 'no triggers');
    container.innerHTML += '<div class="var-item">'
      + '<div class="var-header"><strong>' + escHtml(v.name) + '</strong>'
      + '<button class="btn btn-danger btn-sm" onclick="removeVariable(' + i + ')">Remove</button></div>'
      + '<label>Description</label>'
      + '<input value="' + escHtml(v.description) + '" onchange="variables[' + i + '].description=this.value" />'
      + '<label>Value</label>'
      + '<input type="password" value="' + escHtml(v.value) + '" onchange="variables[' + i + '].value=this.value" />'
      + '<div class="trigger-list">Triggers: ' + escHtml(triggers) + '</div>'
      + '</div>';
  });
}

function addVariable() {
  const name = prompt('Variable name (e.g. SUDO_PASSWORD, MYSQL_ROOT_PASSWORD, or custom):');
  if (!name) return;
  variables.push({
    id: 'var-' + Date.now(),
    name: name,
    description: '',
    value: '',
    triggers: defaultTriggers[name] || [],
  });
  renderVariables();
}

function removeVariable(i) {
  variables.splice(i, 1);
  renderVariables();
}

function escHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function val(id) { return document.getElementById(id)?.value || ''; }

function save() {
  if (!val('name') || !val('host') || !val('username')) {
    alert('Name, Host, and Username are required.');
    return;
  }
  var p = parseInt(val('port'), 10);
  if (isNaN(p) || p < 1 || p > 65535) {
    alert('Port must be between 1 and 65535.');
    return;
  }
  if (val('name').length > 255 || val('host').length > 255) {
    alert('Name and Host must be 255 characters or less.');
    return;
  }
  if (val('username').length > 128) {
    alert('Username must be 128 characters or less.');
    return;
  }
  vscode.postMessage({
    type: 'save',
    data: {
      name: val('name'),
      host: val('host'),
      port: val('port'),
      username: val('username'),
      authType: val('authType'),
      password: val('password'),
      privateKeyPath: val('privateKeyPath'),
      passphrase: val('passphrase'),
      jumpHost: val('jumpHost'),
      jumpPort: val('jumpPort'),
      jumpUsername: val('jumpUsername'),
      jumpAuthType: val('jumpAuthType'),
      jumpPassword: val('jumpPassword'),
      jumpKeyPath: val('jumpKeyPath'),
      variables: variables,
    },
  });
}

function cancel() {
  vscode.postMessage({ type: 'cancel' });
}

renderVariables();
</script>
</body>
</html>`;
  }
}

function esc(val: string | undefined | null): string {
  return (val ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
