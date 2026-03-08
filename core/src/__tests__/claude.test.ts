import { ClaudeAssistant } from '../anthropic/ClaudeAssistant';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  }));
});

const mockServer = { name: 'Test Server', host: '10.0.0.1', username: 'root' };

describe('ClaudeAssistant', () => {
  let assistant: ClaudeAssistant;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    assistant = new ClaudeAssistant('test-api-key');
    mockCreate = (assistant as any).client.messages.create;
  });

  describe('analyzeLogs', () => {
    it('should return parsed analysis result', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: 'High memory usage detected',
            issues: ['OOM killer triggered', 'Swap exhausted'],
            suggestions: ['Increase swap size', 'Check for memory leaks'],
          }),
        }],
      });

      const result = await assistant.analyzeLogs('Jan 1 OOM killer triggered\nSwap used 100%', mockServer);
      expect(result.summary).toBe('High memory usage detected');
      expect(result.issues).toHaveLength(2);
      expect(result.suggestions).toHaveLength(2);
    });

    it('should return fallback on invalid JSON', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'not valid json' }],
      });

      const result = await assistant.analyzeLogs('some logs', mockServer);
      expect(result.summary).toBe('No analysis available');
      expect(result.issues).toEqual([]);
    });

    it('should send correct model and system prompt', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"summary":"ok","issues":[],"suggestions":[]}' }],
      });

      await assistant.analyzeLogs('logs', mockServer);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          system: expect.stringContaining('server diagnostics'),
        }),
      );
    });
  });

  describe('suggestCommands', () => {
    it('should return command suggestions', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify([
            { command: 'top -bn1', description: 'Show CPU usage', risk: 'safe' },
            { command: 'df -h', description: 'Show disk usage', risk: 'safe' },
          ]),
        }],
      });

      const result = await assistant.suggestCommands('server is slow', mockServer);
      expect(result).toHaveLength(2);
      expect(result[0].command).toBe('top -bn1');
      expect(result[0].risk).toBe('safe');
    });

    it('should return empty array on failure', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'invalid' }],
      });

      const result = await assistant.suggestCommands('context', mockServer);
      expect(result).toEqual([]);
    });
  });

  describe('diagnoseError', () => {
    it('should return diagnostic result', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Permission denied',
            cause: 'User lacks sudo privileges',
            fix: 'Add user to sudoers group',
            commands: ['sudo usermod -aG sudo root'],
          }),
        }],
      });

      const result = await assistant.diagnoseError('Permission denied (publickey)', mockServer);
      expect(result.error).toBe('Permission denied');
      expect(result.commands).toHaveLength(1);
    });

    it('should strip markdown fences from response', async () => {
      mockCreate.mockResolvedValue({
        content: [{
          type: 'text',
          text: '```json\n{"error":"test","cause":"c","fix":"f","commands":[]}\n```',
        }],
      });

      const result = await assistant.diagnoseError('some error', mockServer);
      expect(result.error).toBe('test');
    });
  });
});
