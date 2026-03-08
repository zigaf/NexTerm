# NexTerm — Testing Guide

## Automated Tests (core/)

```bash
cd core && npm test
```

**Test suites:**

| Suite | What it covers |
|---|---|
| `vault.test.ts` | Encryption, server CRUD, export/import, settings |
| `vault-regression.test.ts` | Edit-save data integrity, metadata leak prevention |
| `ssh-regression.test.ts` | Connection config, TOFU host verification, key path validation |
| `autofill.test.ts` | Trigger matching, debounce, buffer management |
| `claude.test.ts` | Log analysis, command suggestions, error diagnostics |
| `interactive-session.test.ts` | Streaming chat, terminal buffer, model selection |
| `types.test.ts` | DEFAULT_TRIGGERS, ServerConnection interface |

## Manual Smoke Tests (IntelliJ Plugin)

Run this checklist after every change to `intellij-plugin/`.

### Prerequisites

- JDK 17 (not 25)
- `./gradlew runIde` launches a sandbox IDE

### 1. Server CRUD

- [ ] **Add server** — Click "Add Server", fill all fields, click OK
  - Verify server appears in the list
- [ ] **Edit server** — Select server, click "Edit"
  - Verify all fields pre-filled (including SSH Password as dots)
  - Change server name only, click OK
  - Re-open Edit — verify password is still there
- [ ] **Delete server** — Select server, click "Delete", confirm
  - Verify server removed from list

### 2. Password Preservation (regression)

This is the most critical check. Caught bug: editing a server without
re-entering password was silently erasing it.

- [ ] Add server with Auth Type: Password, enter a password
- [ ] Open Edit dialog — **verify password field shows dots** (not empty)
- [ ] Click OK without changing anything
- [ ] Connect to the server — **verify connection succeeds**
- [ ] Open Edit again — **verify password still shows dots**

### 3. SSH Connection

- [ ] **Password auth** — Add server with password, click Connect
  - Verify terminal opens with shell prompt (not empty)
  - Type a command (`whoami`) — verify output appears
- [ ] **Key auth** — Add server with private key path (`~/.ssh/id_rsa`)
  - Verify connection succeeds
- [ ] **Connection failure** — Add server with wrong host/port
  - Verify **red error message** appears in terminal (not empty window)
- [ ] **Unknown host** — Connect to a server not in `~/.ssh/known_hosts`
  - Verify connection succeeds (TOFU accept)

### 4. Auto-fill

- [ ] Add server with sudo Password variable
- [ ] Connect and run `sudo ls`
- [ ] Verify password prompt bar appears with "sudo password" button
- [ ] Click the button — verify command completes

### 5. Claude Chat

- [ ] Click "Claude Chat" — verify API key prompt (or chat opens if key saved)
- [ ] Click "Ask Claude" in terminal toolbar — verify split pane appears
- [ ] Send a message — verify streaming response

## When to Run What

| Change type | Run |
|---|---|
| `core/src/vault/` | `npm test` — vault suites |
| `core/src/ssh/` | `npm test` — ssh-regression suite |
| `core/src/autofill/` | `npm test` — autofill suite |
| `intellij-plugin/` | `npm test` + Manual smoke tests 1-4 |
| Security hardening | `npm test` + **All** manual smoke tests |
| Any auth/password change | Manual smoke test #2 (Password Preservation) |

## Rules After Security Reviews

Security changes are the most common source of functional regressions.
Follow these rules when applying security hardening:

1. **StrictHostKeyChecking changes** — If you change the value from `"no"`
   to `"ask"` or `"yes"`, you MUST provide a `UserInfo` handler (JSch) or
   `hostVerifier` (ssh2). Without it, unknown hosts silently fail.

2. **Secrets storage changes** — If you move secrets to a separate store
   (PasswordSafe, Keychain), verify that ALL code paths that READ secrets
   are updated. Common miss: edit dialogs reading metadata instead of full data.

3. **Field encryption changes** — If you start encrypting a field that was
   previously plaintext, verify that existing data can still be read
   (migration path).

4. **Run the happy path** — After any security change, manually:
   - Add a new server with password
   - Connect to it
   - Edit it (don't change password)
   - Connect again
