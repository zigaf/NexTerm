# NexTerm — Project Context

## What is NexTerm?
SSH Manager plugin for WebStorm & VSCode — Termius-like experience inside IDE.
GitHub: https://github.com/zigaf/NexTerm

## Stack
- **core/** — TypeScript, shared logic (ssh2, AES-256-GCM vault, autofill, Claude AI)
- **vscode-extension/** — TypeScript VSCode extension
- **intellij-plugin/** — Kotlin, WebStorm/IntelliJ plugin

## Current Status
- Phase 1 (Core TypeScript) — DONE
- Phase 2 (VSCode) — DONE
- Phase 3 (IntelliJ) — DONE
- Phase 4 (Anthropic one-shot) — DONE
- Phase 5 (Interactive Claude) — DONE
- `npm run build` compiles successfully
- 58 tests passing across 5 suites

## Architecture

### core/src/types.ts
Key interfaces: `ServerConnection`, `ServerVariable`, `PromptTrigger`, `JumpHostConfig`
Auth types: `'password' | 'key' | 'jump-host'`

### core/src/vault/NexTermVault.ts
- AES-256-GCM encryption
- Stores servers to `~/.nexterm/nexterm.vault`
- Encrypts all variable values + sensitive fields
- Settings storage (API keys, preferences) — encrypted
- Export/import backup (merge/replace modes)
- API: `saveServer()`, `getServer()`, `getAllServers()`, `deleteServer()`, `exportServers()`, `importServers()`, `setSetting()`, `getSetting()`, `deleteSetting()`

### core/src/ssh/SSHManager.ts
- Uses `ssh2` library
- Supports: password auth, key auth (id_rsa), jump-host (forwardOut)
- Returns `SSHSession` (EventEmitter) emitting: `data`, `close`, `error`
- API: `connect(server)`, `closeAll()`

### core/src/autofill/AutoFillEngine.ts
- Watches terminal output buffer (last 500 chars)
- Matches regex patterns → sends variable value automatically
- Default triggers built-in for SUDO_PASSWORD, MYSQL_ROOT_PASSWORD
- Debounce: 500ms to avoid double-fill

### core/src/anthropic/ClaudeAssistant.ts
- One-shot analysis functions
- API: `analyzeLogs()`, `suggestCommands()`, `diagnoseError()`

### core/src/anthropic/InteractiveSession.ts
- Interactive conversational Claude session with streaming
- Captures terminal output buffer (5000 chars) for context
- Model selection: Haiku / Sonnet / Opus
- Conversation history with sliding window
- API: `chat()` (async generator), `ask()`, `setModel()`, `attachToTerminal()`, `clearHistory()`

### core/src/cli.ts
- CLI entry point: `nexterm-cli`
- Commands: list, add, connect, delete, export, import, claude, diagnose, suggest, set-api-key

### vscode-extension/src/
- `extension.ts` — Commands, PTY integration, Claude chat integration
- `ServerTreeProvider.ts` — Tree view with online/offline status icons
- `panels/ServerFormPanel.ts` — Webview form for Add/Edit server with variable management
- `panels/ClaudeChatPanel.ts` — Interactive Claude chat webview with streaming + model picker
- Commands: `nexterm.addServer`, `nexterm.connect`, `nexterm.editServer`, `nexterm.deleteServer`, `nexterm.claudeChat`, `nexterm.setApiKey`

### intellij-plugin/
- `model/ServerConnection.kt` — Data classes with password/passphrase fields
- `vault/NexTermVaultService.kt` — PersistentStateComponent + PasswordSafe (OS keychain)
- `ssh/SSHConnectionManager.kt` — JSch + coroutines + AutoFillDetector
- `ssh/SSHTtyConnector.kt` — TtyConnector for JBTerminalWidget integration
- `ui/NexTermToolWindowFactory.kt` — Tool Window with server list + embedded terminal tabs
- `ui/AddServerDialog.kt` — Dialog for adding servers
- `ui/EditServerDialog.kt` — Dialog for editing servers (pre-fills fields)
- `plugin.xml` — registers toolWindow + applicationService

## Key Design Decisions
1. Core is TypeScript — shared between VSCode (native) and IntelliJ (subprocess)
2. Secrets encrypted with AES-256-GCM, never stored in plaintext
3. AutoFill uses regex buffer matching with debounce
4. IntelliJ uses OS Keychain (PasswordSafe API) for extra security
5. Claude sessions capture terminal output buffer for context-aware assistance
6. API keys stored encrypted in vault

## DONE — Phase 1 (Core)
- [x] Add jest.config.js and run tests
- [x] Fix: `password` field not in ServerConnection type
- [x] Fix: SSHManager.connect vault param unused
- [x] Add CLI for manual testing: `npx nexterm-cli connect`
- [x] Add server export/import (backup)

## DONE — Phase 2 (VSCode)
- [x] Webview UI for Add/Edit server (replace quick-pick wizard)
- [x] Show connection status in tree (online/offline icon)
- [x] Manage variables per server

## DONE — Phase 3 (IntelliJ)
- [x] Real terminal integration (JBTerminalWidget + SSHTtyConnector)
- [x] Edit server dialog

## DONE — Phase 4 (Anthropic)
- [x] Claude analyzes server logs
- [x] Command suggestions based on server context
- [x] Auto-diagnose terminal errors

## DONE — Phase 5 (Interactive Claude)
- [x] InteractiveClaudeSession with streaming responses
- [x] Terminal output buffer capture (5000 chars context)
- [x] Model selection: Haiku / Sonnet / Opus
- [x] Conversation history management
- [x] CLI: `nexterm-cli claude [serverId]` with /model, /clear, /exit
- [x] VSCode: ClaudeChatPanel webview with streaming + model picker
- [x] API key storage in vault (encrypted)
- [x] 20 new tests (58 total)

## File Structure
```
NexTerm/
├── core/
│   ├── package.json        (@nexterm/core, bin: nexterm-cli)
│   ├── tsconfig.json       (ES2020, commonjs, strict)
│   ├── jest.config.js      (ts-jest)
│   └── src/
│       ├── types.ts
│       ├── index.ts        (exports all)
│       ├── cli.ts           (CLI entry point)
│       ├── ssh/SSHManager.ts
│       ├── vault/NexTermVault.ts
│       ├── autofill/AutoFillEngine.ts
│       ├── anthropic/ClaudeAssistant.ts
│       ├── anthropic/InteractiveSession.ts
│       └── __tests__/
│           ├── vault.test.ts
│           ├── autofill.test.ts
│           ├── types.test.ts
│           ├── claude.test.ts
│           └── interactive-session.test.ts
├── vscode-extension/
│   ├── package.json        (deps: @nexterm/core)
│   ├── tsconfig.json
│   └── src/
│       ├── extension.ts
│       ├── ServerTreeProvider.ts
│       └── panels/
│           ├── ServerFormPanel.ts
│           └── ClaudeChatPanel.ts
└── intellij-plugin/
    ├── build.gradle.kts    (kotlin 1.9.22, intellij 1.17.2, type=WS)
    └── src/main/
        ├── kotlin/com/nexterm/
        │   ├── model/ServerConnection.kt
        │   ├── ssh/SSHConnectionManager.kt
        │   ├── ssh/SSHTtyConnector.kt
        │   ├── ui/NexTermToolWindowFactory.kt
        │   ├── ui/AddServerDialog.kt
        │   ├── ui/EditServerDialog.kt
        │   └── vault/NexTermVaultService.kt
        └── resources/META-INF/plugin.xml
```
