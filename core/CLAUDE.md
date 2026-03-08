# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NexTerm is an SSH Manager plugin ecosystem for VSCode and WebStorm/IntelliJ, providing Termius-like SSH management inside IDEs. This repo (`core/`) is the shared TypeScript library consumed by both IDE extensions.

## Monorepo Structure

This is one of three packages in the NexTerm monorepo (`NexTerm/`):
- **`core/`** (this package) — Shared TypeScript library: SSH client, encrypted vault, auto-fill engine
- **`vscode-extension/`** — VSCode extension, depends on `@nexterm/core` via `file:../core`
- **`intellij-plugin/`** — Kotlin/Gradle plugin for WebStorm/IntelliJ (JSch, coroutines)

## Build & Test Commands

```bash
npm run build        # Compile TypeScript → dist/ (tsc)
npm run dev          # Watch mode (tsc --watch)
npm test             # Run Jest tests (ts-jest)
```

No linter is configured yet. Jest config references `__tests__/**/*.test.ts` pattern with `ts-jest` preset.

## Architecture

### Core Modules

**`src/types.ts`** — All shared interfaces: `ServerConnection`, `ServerVariable`, `PromptTrigger`, `JumpHostConfig`. Auth types are `'password' | 'key' | 'jump-host'`.

**`src/vault/NexTermVault.ts`** — Encrypted storage using AES-256-GCM (Node.js `crypto`). Key derived via `crypto.scryptSync` with a fixed salt. Vault file lives at `~/.nexterm/nexterm.vault` with 0o600 permissions. Encrypts passwords and all variable values; metadata stored in plaintext.

**`src/ssh/SSHManager.ts`** — Wraps `ssh2` library. Supports password auth, key-based auth, and jump-host (bastion) tunneling via `forwardOut`. Returns `SSHSession` (extends `EventEmitter`) emitting `data`, `close`, `error` events. Default PTY: 220x50 cols/rows.

**`src/autofill/AutoFillEngine.ts`** — Watches terminal output buffer (last 500 chars), matches regex triggers from server variables, and sends variable values automatically. 500ms debounce prevents double-fills. Built-in default triggers for sudo and MySQL password prompts.

**`src/index.ts`** — Barrel export re-exporting all public classes and interfaces.

### Data Flow

1. IDE extension initializes `NexTermVault` with a master password (VSCode derives it from extension storage path)
2. User selects a server → `SSHManager.connect(server, vault)` establishes SSH (optionally through jump-host)
3. `SSHSession` EventEmitter streams terminal I/O
4. `AutoFillEngine` attaches to session, buffering output and auto-filling when regex triggers match

### IDE Integration Patterns

- **VSCode**: Uses `vscode.Pseudoterminal` API — SSH output maps to `onDidWrite`, user input maps to `handleInput`
- **IntelliJ**: Uses JSch + Kotlin coroutines in IO dispatcher, OS Keychain via `PasswordSafe` API

## Key Dependencies

- `ssh2` — Node.js SSH2 client
- `keytar` — OS-level keychain access
- `crypto-js` — Additional crypto utilities (core encryption uses Node.js `crypto`)
- `@anthropic-ai/sdk` — Placeholder for planned Claude AI integration (Phase 4)

## Known Issues & Active TODOs

- `password` field is not in `ServerConnection` type but is used via `any` cast in SSHManager
- `vault` parameter in `SSHManager.connect()` is accepted but unused
- Jest config (`jest.config.js`) referenced in task but not yet created
- No ESLint/Prettier configuration exists yet

## Compiler Settings

TypeScript strict mode enabled, targeting ES2020 with CommonJS output. Declaration files and source maps are generated in `dist/`.
