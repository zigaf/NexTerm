import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { InteractiveClaudeSession, CLAUDE_MODELS, ClaudeModelAlias } from '@nexterm/core';

export class ClaudeChatPanel {
  private static instance: ClaudeChatPanel | null = null;
  private panel: vscode.WebviewPanel;
  private session: InteractiveClaudeSession;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    session: InteractiveClaudeSession,
  ) {
    this.panel = panel;
    this.session = session;
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => {
      ClaudeChatPanel.instance = null;
      this.disposables.forEach(d => d.dispose());
    }, null, this.disposables);
  }

  static open(
    extensionUri: vscode.Uri,
    session: InteractiveClaudeSession,
  ) {
    if (ClaudeChatPanel.instance) {
      ClaudeChatPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'nexterm.claudeChat',
      'NexTerm Claude',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    ClaudeChatPanel.instance = new ClaudeChatPanel(panel, session);
  }

  private async handleMessage(msg: any) {
    switch (msg.type) {
      case 'sendMessage': {
        // Start streaming response
        this.panel.webview.postMessage({ type: 'streamStart' });
        try {
          for await (const chunk of this.session.chat(msg.text)) {
            this.panel.webview.postMessage({ type: 'streamChunk', text: chunk });
          }
          this.panel.webview.postMessage({ type: 'streamEnd' });
        } catch (err: any) {
          this.panel.webview.postMessage({ type: 'error', text: err.message });
        }
        break;
      }
      case 'setModel': {
        this.session.setModel(msg.model as ClaudeModelAlias);
        break;
      }
      case 'clearHistory': {
        this.session.clearHistory();
        break;
      }
    }
  }

  private getHtml(): string {
    const currentModel = this.session.getModel();
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
    --border: var(--vscode-panel-border, #3c3c3c);
    --user-bg: var(--vscode-textBlockQuote-background, #2a2a2a);
    --assistant-bg: transparent;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); display: flex; flex-direction: column; height: 100vh; }

  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .toolbar select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 3px 6px; border-radius: 3px; font-size: 12px; }
  .toolbar button { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.7; font-size: 12px; }
  .toolbar button:hover { opacity: 1; }

  .messages { flex: 1; overflow-y: auto; padding: 12px; }
  .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: var(--user-bg); }
  .msg.assistant { background: var(--assistant-bg); }
  .msg .role { font-size: 11px; font-weight: 600; margin-bottom: 4px; opacity: 0.6; }

  .input-area { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
  .input-area textarea {
    flex: 1; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 4px;
    padding: 8px; font-size: 13px; font-family: inherit; resize: none;
    min-height: 40px; max-height: 120px;
  }
  .input-area textarea:focus { outline: 1px solid var(--btn-bg); border-color: var(--btn-bg); }
  .input-area button {
    background: var(--btn-bg); color: var(--btn-fg); border: none;
    border-radius: 4px; padding: 8px 16px; cursor: pointer; font-size: 13px;
    align-self: flex-end;
  }
  .input-area button:hover { background: var(--btn-hover); }
  .input-area button:disabled { opacity: 0.5; cursor: default; }

  .typing { opacity: 0.5; font-style: italic; }
</style>
</head>
<body>

<div class="toolbar">
  <span>Model:</span>
  <select id="model" onchange="setModel(this.value)">
    <option value="haiku" ${currentModel === 'haiku' ? 'selected' : ''}>Haiku (fast)</option>
    <option value="sonnet" ${currentModel === 'sonnet' ? 'selected' : ''}>Sonnet</option>
    <option value="opus" ${currentModel === 'opus' ? 'selected' : ''}>Opus (powerful)</option>
  </select>
  <span style="flex:1"></span>
  <button onclick="clearChat()">Clear chat</button>
</div>

<div class="messages" id="messages">
  <div class="msg assistant"><div class="role">claude</div>Ready. I can see your terminal output and help with server tasks. Ask me anything.</div>
</div>

<div class="input-area">
  <textarea id="input" placeholder="Ask Claude..." rows="1" onkeydown="handleKey(event)"></textarea>
  <button id="sendBtn" onclick="send()">Send</button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
let streaming = false;
let currentAssistantEl = null;

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const roleLabel = document.createElement('div');
  roleLabel.className = 'role';
  roleLabel.textContent = role === 'user' ? 'you' : 'claude';
  div.appendChild(roleLabel);
  const content = document.createElement('span');
  content.textContent = text;
  div.appendChild(content);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return content;
}

function send() {
  const text = inputEl.value.trim();
  if (!text || streaming) return;

  addMessage('user', text);
  inputEl.value = '';
  inputEl.style.height = 'auto';

  vscode.postMessage({ type: 'sendMessage', text });
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
  // Auto-resize textarea
  setTimeout(() => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }, 0);
}

function setModel(model) {
  vscode.postMessage({ type: 'setModel', model });
}

function clearChat() {
  vscode.postMessage({ type: 'clearHistory' });
  messagesEl.innerHTML = '';
  addMessage('assistant', 'Chat cleared. Ready for new questions.');
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'streamStart':
      streaming = true;
      sendBtn.disabled = true;
      currentAssistantEl = addMessage('assistant', '');
      break;
    case 'streamChunk':
      if (currentAssistantEl) {
        currentAssistantEl.textContent += msg.text;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      break;
    case 'streamEnd':
      streaming = false;
      sendBtn.disabled = false;
      currentAssistantEl = null;
      inputEl.focus();
      break;
    case 'error':
      streaming = false;
      sendBtn.disabled = false;
      addMessage('assistant', 'Error: ' + msg.text);
      currentAssistantEl = null;
      break;
  }
});

inputEl.focus();
</script>
</body>
</html>`;
  }
}
