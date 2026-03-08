import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { InteractiveClaudeSession, CLAUDE_MODELS, ClaudeModelAlias } from '@nexterm/core';

export class ClaudeChatPanel {
  private static instance: ClaudeChatPanel | null = null;
  private panel: vscode.WebviewPanel;
  private session: InteractiveClaudeSession;
  private serverName: string | null;
  private onRunCommand: ((command: string) => void) | null;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    session: InteractiveClaudeSession,
    serverName: string | null,
    onRunCommand: ((command: string) => void) | null,
  ) {
    this.panel = panel;
    this.session = session;
    this.serverName = serverName;
    this.onRunCommand = onRunCommand;
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
    serverName?: string | null,
    onRunCommand?: (command: string) => void,
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

    ClaudeChatPanel.instance = new ClaudeChatPanel(
      panel,
      session,
      serverName ?? null,
      onRunCommand ?? null,
    );
  }

  private async handleMessage(msg: any) {
    switch (msg.type) {
      case 'sendMessage': {
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
      case 'runCommand': {
        if (this.onRunCommand) {
          this.onRunCommand(msg.command);
        } else {
          vscode.window.showWarningMessage('NexTerm: No active terminal. Connect to a server first.');
        }
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

  /* Animations */
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes dotPulse {
    0%, 80%, 100% { opacity: 0.15; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .toolbar select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 3px 6px; border-radius: 3px; font-size: 12px; }
  .toolbar button { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.7; font-size: 12px; transition: opacity 0.15s; }
  .toolbar button:hover { opacity: 1; }

  .messages { flex: 1; overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
  .msg {
    margin-bottom: 12px; padding: 8px 12px; border-radius: 6px;
    font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    animation: fadeInUp 0.3s ease-out;
  }
  .msg.user { background: var(--user-bg); }
  .msg.assistant { background: var(--assistant-bg); }
  .msg .role { font-size: 11px; font-weight: 600; margin-bottom: 4px; opacity: 0.6; }
  .msg .content { white-space: pre-wrap; word-break: break-word; }

  /* Thinking indicator */
  .thinking {
    display: flex; align-items: center; gap: 10px;
    padding: 12px; animation: fadeInUp 0.3s ease-out;
  }
  .thinking-dots { display: flex; gap: 5px; }
  .thinking-dots span {
    width: 7px; height: 7px;
    background: var(--fg); border-radius: 50%;
    display: inline-block;
    animation: dotPulse 1.4s ease-in-out infinite;
  }
  .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
  .thinking-label { font-size: 12px; opacity: 0.4; font-style: italic; }

  /* Streaming cursor */
  .cursor {
    display: inline; margin-left: 1px;
    animation: cursorBlink 0.7s step-end infinite;
    color: var(--fg); opacity: 0.7;
  }

  /* Clickable command blocks */
  .command-block {
    display: flex; align-items: center;
    background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.04));
    border: 1px solid var(--border); border-radius: 4px;
    padding: 6px 10px; margin: 4px 0;
    cursor: pointer; font-size: 12px;
    transition: all 0.15s ease; user-select: none;
  }
  .command-block:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.08));
    border-color: var(--btn-bg);
  }
  .command-block:active { transform: scale(0.98); }
  .command-block .cmd-text {
    flex: 1;
    color: var(--vscode-terminal-ansiGreen, #4ec9b0);
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .command-block .cmd-run {
    margin-left: 8px; opacity: 0;
    font-size: 11px; color: var(--btn-bg);
    transition: opacity 0.15s ease; white-space: nowrap;
  }
  .command-block:hover .cmd-run { opacity: 0.8; }
  .command-block.sent {
    border-color: var(--vscode-terminal-ansiGreen, #4ec9b0);
    opacity: 0.6;
  }

  .input-area { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
  .input-area textarea {
    flex: 1; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 4px;
    padding: 8px; font-size: 13px; font-family: inherit; resize: none;
    min-height: 40px; max-height: 120px; transition: height 0.15s ease;
  }
  .input-area textarea:focus { outline: 1px solid var(--btn-bg); border-color: var(--btn-bg); }
  .input-area button {
    background: var(--btn-bg); color: var(--btn-fg); border: none;
    border-radius: 4px; padding: 8px 16px; cursor: pointer; font-size: 13px;
    align-self: flex-end; transition: opacity 0.15s, background 0.15s;
  }
  .input-area button:hover { background: var(--btn-hover); }
  .input-area button:disabled { opacity: 0.5; cursor: default; }
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
  <button onclick="clearChat()">Clear</button>
</div>

<div class="messages" id="messages">
  <div class="msg assistant">
    <div class="role">claude</div>
    <div class="content">Ready. I can see your terminal output and help with server tasks. Ask me anything.</div>
  </div>
</div>

<div class="input-area">
  <textarea id="input" placeholder="Ask Claude..." rows="1" onkeydown="handleKey(event)"></textarea>
  <button id="sendBtn" onclick="send()">Send</button>
</div>

<script nonce="${nonce}">
var vscode = acquireVsCodeApi();
var messagesEl = document.getElementById('messages');
var inputEl = document.getElementById('input');
var sendBtn = document.getElementById('sendBtn');
var streaming = false;
var currentAssistantEl = null;
var thinkingEl = null;
var cursorEl = null;
var textNode = null;
var fullResponseText = '';
var tick3 = String.fromCharCode(96, 96, 96);
var NL = String.fromCharCode(10);
var PLAY = String.fromCharCode(9654);
var CURSOR_CHAR = String.fromCharCode(9611);

function escapeHtml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text) {
  var div = document.createElement('div');
  div.className = 'msg ' + role;
  var roleLabel = document.createElement('div');
  roleLabel.className = 'role';
  roleLabel.textContent = role === 'user' ? 'you' : 'claude';
  div.appendChild(roleLabel);
  var content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  div.appendChild(content);
  messagesEl.appendChild(div);
  scrollToBottom();
  return content;
}

function addThinking() {
  var div = document.createElement('div');
  div.className = 'thinking';
  var dots = document.createElement('div');
  dots.className = 'thinking-dots';
  for (var i = 0; i < 3; i++) {
    dots.appendChild(document.createElement('span'));
  }
  div.appendChild(dots);
  var label = document.createElement('span');
  label.className = 'thinking-label';
  label.textContent = 'Thinking...';
  div.appendChild(label);
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function removeThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

function addCursor(container) {
  removeCursor();
  cursorEl = document.createElement('span');
  cursorEl.className = 'cursor';
  cursorEl.textContent = CURSOR_CHAR;
  container.appendChild(cursorEl);
}

function removeCursor() {
  if (cursorEl) { cursorEl.remove(); cursorEl = null; }
}

function formatResponse(text) {
  return text.split(NL).map(function(line) {
    if (line.indexOf(tick3) === 0) return '';
    if (line.indexOf('$ ') === 0 && line.length > 2) {
      var cmd = line.substring(2);
      var esc = escapeHtml(cmd).replace(/"/g, '&quot;');
      return '<div class="command-block" data-cmd="' + esc + '">' +
        '<span class="cmd-text">$ ' + escapeHtml(cmd) + '</span>' +
        '<span class="cmd-run">' + PLAY + ' Run</span></div>';
    }
    return escapeHtml(line);
  }).join(NL);
}

function runCommand(el) {
  var cmd = el.getAttribute('data-cmd');
  if (!cmd) return;
  vscode.postMessage({ type: 'runCommand', command: cmd });
  el.classList.add('sent');
  var runLabel = el.querySelector('.cmd-run');
  if (runLabel) runLabel.textContent = 'sent!';
  setTimeout(function() {
    el.classList.remove('sent');
    if (runLabel) runLabel.textContent = PLAY + ' Run';
  }, 2000);
}

// Delegated click handler for command blocks
messagesEl.addEventListener('click', function(e) {
  var block = e.target.closest('.command-block');
  if (block) runCommand(block);
});

function send() {
  var text = inputEl.value.trim();
  if (!text || streaming) return;
  addMessage('user', text);
  inputEl.value = '';
  inputEl.style.height = 'auto';
  vscode.postMessage({ type: 'sendMessage', text: text });
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
  setTimeout(function() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }, 0);
}

function setModel(model) {
  vscode.postMessage({ type: 'setModel', model: model });
}

function clearChat() {
  vscode.postMessage({ type: 'clearHistory' });
  messagesEl.innerHTML = '';
  addMessage('assistant', 'Chat cleared. Ready for new questions.');
}

window.addEventListener('message', function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'streamStart':
      streaming = true;
      sendBtn.disabled = true;
      fullResponseText = '';
      textNode = null;
      thinkingEl = addThinking();
      break;

    case 'streamChunk':
      removeThinking();
      if (!currentAssistantEl) {
        currentAssistantEl = addMessage('assistant', '');
        currentAssistantEl.textContent = '';
        textNode = document.createTextNode('');
        currentAssistantEl.appendChild(textNode);
        addCursor(currentAssistantEl);
      }
      fullResponseText += msg.text;
      if (textNode) textNode.nodeValue = fullResponseText;
      scrollToBottom();
      break;

    case 'streamEnd':
      streaming = false;
      sendBtn.disabled = false;
      removeThinking();
      removeCursor();
      if (currentAssistantEl && fullResponseText) {
        currentAssistantEl.innerHTML = formatResponse(fullResponseText);
      }
      currentAssistantEl = null;
      textNode = null;
      fullResponseText = '';
      inputEl.focus();
      break;

    case 'error':
      streaming = false;
      sendBtn.disabled = false;
      removeThinking();
      removeCursor();
      addMessage('assistant', 'Error: ' + msg.text);
      currentAssistantEl = null;
      textNode = null;
      fullResponseText = '';
      break;
  }
});

inputEl.focus();
</script>
</body>
</html>`;
  }
}
