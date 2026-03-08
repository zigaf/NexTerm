import Anthropic from '@anthropic-ai/sdk';
import { ServerConnection } from '../types';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;

export interface AnalysisResult {
  summary: string;
  issues: string[];
  suggestions: string[];
}

export interface CommandSuggestion {
  command: string;
  description: string;
  risk: 'safe' | 'moderate' | 'dangerous';
}

export interface DiagnosticResult {
  error: string;
  cause: string;
  fix: string;
  commands: string[];
}

export class ClaudeAssistant {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  // ── Log Analysis ──────────────────────────────────────────────

  async analyzeLogs(
    logs: string,
    server: Pick<ServerConnection, 'name' | 'host' | 'username'>,
  ): Promise<AnalysisResult> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `You are a Linux server diagnostics assistant. Analyze server logs and output JSON with these fields:
- "summary": brief plain-text summary of what the logs show
- "issues": array of identified problems
- "suggestions": array of actionable recommendations
Respond with ONLY valid JSON, no markdown.`,
      messages: [{
        role: 'user',
        content: `Server: ${server.name} (${server.username}@${server.host})\n\nLogs:\n${truncate(logs, 6000)}`,
      }],
    });

    return parseJson<AnalysisResult>(extractText(response), {
      summary: 'No analysis available',
      issues: [],
      suggestions: [],
    });
  }

  // ── Command Suggestions ───────────────────────────────────────

  async suggestCommands(
    context: string,
    server: Pick<ServerConnection, 'name' | 'host' | 'username'>,
  ): Promise<CommandSuggestion[]> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `You are a Linux command assistant. Based on the user's context (terminal output or question), suggest relevant commands.
Output a JSON array of objects with:
- "command": the shell command
- "description": what it does (1 sentence)
- "risk": "safe", "moderate", or "dangerous"
Respond with ONLY a valid JSON array, no markdown. Suggest 3-5 commands.`,
      messages: [{
        role: 'user',
        content: `Server: ${server.name} (${server.username}@${server.host})\n\nContext:\n${truncate(context, 4000)}`,
      }],
    });

    return parseJson<CommandSuggestion[]>(extractText(response), []);
  }

  // ── Error Diagnosis ───────────────────────────────────────────

  async diagnoseError(
    terminalOutput: string,
    server: Pick<ServerConnection, 'name' | 'host' | 'username'>,
  ): Promise<DiagnosticResult> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `You are a Linux troubleshooting expert. Diagnose the terminal error and output JSON with:
- "error": the specific error identified
- "cause": likely root cause (1-2 sentences)
- "fix": recommended fix (1-2 sentences)
- "commands": array of commands to run to fix it
Respond with ONLY valid JSON, no markdown.`,
      messages: [{
        role: 'user',
        content: `Server: ${server.name} (${server.username}@${server.host})\n\nTerminal output:\n${truncate(terminalOutput, 4000)}`,
      }],
    });

    return parseJson<DiagnosticResult>(extractText(response), {
      error: 'Unknown error',
      cause: 'Unable to determine cause',
      fix: 'Please review the output manually',
      commands: [],
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────

function extractText(response: Anthropic.Message): string {
  const block = response.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(text.length - maxLen);
}
