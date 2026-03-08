# NexTerm

SSH Manager plugin for WebStorm & VSCode — Termius inside your IDE.

## Features

- 🖥️ Manage SSH server connections directly in your IDE
- 🔐 Secure local storage of passwords and keys (AES-256)
- ⚡ Auto-fill sudo passwords, MySQL root passwords on prompt detection
- 🔑 SSH by password, by key (id_rsa), and through jump-host/bastion
- 🤖 Anthropic Claude integration (coming soon)

## Project Structure

```
nexterm/
├── core/                  # TypeScript — shared SSH logic, vault, autofill
│   └── src/
│       ├── ssh/           # SSH client, jump-host, key auth
│       ├── vault/         # AES-256 encrypted secrets storage
│       ├── autofill/      # Prompt detection & auto-fill engine
│       └── anthropic/     # Claude AI integration
├── vscode-extension/      # VSCode extension (TypeScript)
└── intellij-plugin/       # IntelliJ/WebStorm plugin (Kotlin)
```

## Getting Started

### Core
```bash
cd core
npm install
npm run build
```

### VSCode Extension
```bash
cd vscode-extension
npm install
npm run build
# Press F5 in VSCode to launch Extension Development Host
```

### IntelliJ Plugin
```bash
cd intellij-plugin
./gradlew runIde
```
