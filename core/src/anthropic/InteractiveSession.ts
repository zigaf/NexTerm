import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { ServerConnection } from '../types';
import { SSHSession } from '../ssh/SSHManager';

// ── Models ──────────────────────────────────────────────────────

export const CLAUDE_MODELS = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
} as const;

export type ClaudeModelAlias = keyof typeof CLAUDE_MODELS;
export type ClaudeModelId = (typeof CLAUDE_MODELS)[ClaudeModelAlias];

// ── Types ───────────────────────────────────────────────────────

export interface InteractiveSessionConfig {
  apiKey?: string;
  model?: ClaudeModelAlias;
  maxHistoryMessages?: number;
  terminalBufferSize?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ── Interactive Session ─────────────────────────────────────────

export class InteractiveClaudeSession extends EventEmitter {
  private client: Anthropic;
  private model: ClaudeModelId;
  private history: Anthropic.MessageParam[] = [];
  private chatLog: ChatMessage[] = [];
  private terminalChunks: string[] = [];
  private terminalLength = 0;
  private serverContext: Pick<ServerConnection, 'name' | 'host' | 'username'> | null = null;

  private maxHistory: number;
  private bufferSize: number;
  private maxTokens: number;

  constructor(config: InteractiveSessionConfig = {}) {
    super();
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = CLAUDE_MODELS[config.model ?? 'sonnet'];
    this.maxHistory = config.maxHistoryMessages ?? 20;
    this.bufferSize = config.terminalBufferSize ?? 5000;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  // ── Model Selection ───────────────────────────────────────────

  setModel(alias: ClaudeModelAlias): void {
    this.model = CLAUDE_MODELS[alias];
    this.emit('modelChanged', alias);
  }

  getModel(): ClaudeModelAlias {
    const entry = Object.entries(CLAUDE_MODELS).find(([, id]) => id === this.model);
    return (entry?.[0] ?? 'sonnet') as ClaudeModelAlias;
  }

  // ── Terminal Capture ──────────────────────────────────────────

  attachToTerminal(session: SSHSession, server: ServerConnection): void {
    this.serverContext = { name: server.name, host: server.host, username: server.username };

    session.on('data', (data: string) => {
      this.terminalChunks.push(data);
      this.terminalLength += data.length;
      if (this.terminalLength > this.bufferSize * 2) {
        this.compactBuffer();
      }
    });

    session.on('close', () => {
      this.emit('sessionClosed');
    });
  }

  setServerContext(server: Pick<ServerConnection, 'name' | 'host' | 'username'>): void {
    this.serverContext = server;
  }

  getTerminalBuffer(): string {
    const joined = this.terminalChunks.join('');
    return joined.length > this.bufferSize
      ? joined.slice(-this.bufferSize)
      : joined;
  }

  private compactBuffer(): void {
    const joined = this.terminalChunks.join('');
    const trimmed = joined.slice(-this.bufferSize);
    this.terminalChunks = [trimmed];
    this.terminalLength = trimmed.length;
  }

  // ── Streaming Chat ────────────────────────────────────────────

  async *chat(userMessage: string): AsyncGenerator<string, void, undefined> {
    // Build user message with terminal context
    const terminalContent = this.getTerminalBuffer();
    const contextBlock = terminalContent.length > 0
      ? `\n\n<terminal_output>\n${terminalContent}\n</terminal_output>`
      : '';

    const fullUserMessage = userMessage + contextBlock;

    // Add to history
    this.history.push({ role: 'user', content: fullUserMessage });
    this.chatLog.push({ role: 'user', content: userMessage, timestamp: new Date() });

    // Trim history to stay within limits
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.buildSystemPrompt(),
      messages: this.history,
    });

    let fullResponse = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullResponse += chunk;
        this.emit('chunk', chunk);
        yield chunk;
      }
    }

    // Save assistant response to history
    this.history.push({ role: 'assistant', content: fullResponse });
    this.chatLog.push({ role: 'assistant', content: fullResponse, timestamp: new Date() });

    this.emit('responseComplete', fullResponse);
  }

  // ── Non-streaming Chat (convenience) ──────────────────────────

  async ask(userMessage: string): Promise<string> {
    let result = '';
    for await (const chunk of this.chat(userMessage)) {
      result += chunk;
    }
    return result;
  }

  // ── History Management ────────────────────────────────────────

  getHistory(): ChatMessage[] {
    return [...this.chatLog];
  }

  clearHistory(): void {
    this.history = [];
    this.chatLog = [];
    this.emit('historyCleared');
  }

  clearTerminalBuffer(): void {
    this.terminalChunks = [];
    this.terminalLength = 0;
  }

  // ── System Prompt ─────────────────────────────────────────────

  private buildSystemPrompt(): string {
    const serverInfo = this.serverContext
      ? `The user is connected to: ${this.serverContext.name} (${this.serverContext.username}@${this.serverContext.host})`
      : 'No server connection context available.';

    return `You are a Linux server assistant embedded in a terminal SSH manager called NexTerm.

${serverInfo}

You can see recent terminal output wrapped in <terminal_output> tags in the user messages. Use this context to understand what's happening on the server.

Guidelines:
- Be concise and practical
- When suggesting commands, prefix with $ for easy copying
- Warn about dangerous commands (rm -rf, dd, etc.)
- If you see an error in the terminal output, proactively explain it
- You can analyze logs, suggest fixes, explain output, and help with server administration
- Format output as plain text (no markdown headers), use indentation for structure`;
  }
}
