import { ServerConnection, ServerVariable, DEFAULT_TRIGGERS } from '../types';
import { SSHSession } from '../ssh/SSHManager';

export class AutoFillEngine {
  private buffer = '';
  private lastFillTime = 0;
  private readonly DEBOUNCE_MS = 500;
  private compiledTriggers = new Map<string, RegExp>();

  /**
   * Attach auto-fill to an SSH session.
   * Watches terminal output and sends variable values when prompts are detected.
   */
  attach(session: SSHSession, server: ServerConnection): void {
    // Pre-compile all trigger regexes once
    for (const variable of server.variables) {
      const triggers = variable.triggers.length > 0
        ? variable.triggers
        : this.getDefaultTriggers(variable.name);

      for (const trigger of triggers) {
        if (!this.compiledTriggers.has(trigger.pattern)) {
          try {
            this.compiledTriggers.set(trigger.pattern, new RegExp(trigger.pattern, 'i'));
          } catch {
            // Skip invalid regex patterns
          }
        }
      }
    }

    session.on('data', (data: string) => {
      this.buffer += data;

      // Keep buffer manageable (last 500 chars)
      if (this.buffer.length > 500) {
        this.buffer = this.buffer.slice(-500);
      }

      this.checkTriggers(session, server);
    });
  }

  private checkTriggers(session: SSHSession, server: ServerConnection): void {
    const now = Date.now();
    if (now - this.lastFillTime < this.DEBOUNCE_MS) return;

    for (const variable of server.variables) {
      const triggers = variable.triggers.length > 0
        ? variable.triggers
        : this.getDefaultTriggers(variable.name);

      for (const trigger of triggers) {
        const regex = this.compiledTriggers.get(trigger.pattern);
        if (regex && regex.test(this.buffer)) {
          session.write(variable.value + '\n');
          this.buffer = ''; // clear buffer after fill
          this.lastFillTime = now;
          return;
        }
      }
    }
  }

  private getDefaultTriggers(variableName: string) {
    return DEFAULT_TRIGGERS[variableName] ?? [];
  }
}
