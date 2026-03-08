import { EventEmitter } from 'events';
import { InteractiveClaudeSession, CLAUDE_MODELS, ClaudeModelAlias } from '../anthropic/InteractiveSession';
import { SSHSession } from '../ssh/SSHManager';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  }));
});

function createMockSession(): SSHSession & EventEmitter {
  const emitter = new EventEmitter() as SSHSession & EventEmitter;
  emitter.id = 'test-session';
  emitter.write = jest.fn();
  emitter.resize = jest.fn();
  emitter.close = jest.fn();
  return emitter;
}

describe('InteractiveClaudeSession', () => {
  let session: InteractiveClaudeSession;

  beforeEach(() => {
    session = new InteractiveClaudeSession({ apiKey: 'test-key' });
  });

  describe('model selection', () => {
    it('should default to sonnet', () => {
      expect(session.getModel()).toBe('sonnet');
    });

    it('should accept model in constructor', () => {
      const s = new InteractiveClaudeSession({ apiKey: 'key', model: 'opus' });
      expect(s.getModel()).toBe('opus');
    });

    it('should switch model at runtime', () => {
      session.setModel('haiku');
      expect(session.getModel()).toBe('haiku');

      session.setModel('opus');
      expect(session.getModel()).toBe('opus');
    });

    it('should emit modelChanged event', () => {
      const handler = jest.fn();
      session.on('modelChanged', handler);
      session.setModel('opus');
      expect(handler).toHaveBeenCalledWith('opus');
    });
  });

  describe('CLAUDE_MODELS', () => {
    it('should have all three models', () => {
      expect(CLAUDE_MODELS.haiku).toBeDefined();
      expect(CLAUDE_MODELS.sonnet).toBeDefined();
      expect(CLAUDE_MODELS.opus).toBeDefined();
    });

    it('should contain valid model IDs', () => {
      expect(CLAUDE_MODELS.haiku).toContain('haiku');
      expect(CLAUDE_MODELS.sonnet).toContain('sonnet');
      expect(CLAUDE_MODELS.opus).toContain('opus');
    });
  });

  describe('terminal buffer capture', () => {
    it('should capture terminal output', () => {
      const sshSession = createMockSession();
      session.attachToTerminal(sshSession, {
        id: 'srv-1', name: 'Test', host: '10.0.0.1', port: 22,
        username: 'root', authType: 'password', variables: [],
        createdAt: new Date(), updatedAt: new Date(),
      });

      sshSession.emit('data', 'hello world');
      expect(session.getTerminalBuffer()).toBe('hello world');

      sshSession.emit('data', ' more data');
      expect(session.getTerminalBuffer()).toBe('hello world more data');
    });

    it('should keep buffer under configured size', () => {
      const s = new InteractiveClaudeSession({
        apiKey: 'key',
        terminalBufferSize: 20,
      });
      const sshSession = createMockSession();
      s.attachToTerminal(sshSession, {
        id: 'srv-1', name: 'Test', host: '10.0.0.1', port: 22,
        username: 'root', authType: 'password', variables: [],
        createdAt: new Date(), updatedAt: new Date(),
      });

      sshSession.emit('data', 'a'.repeat(30));
      expect(s.getTerminalBuffer().length).toBe(20);
    });

    it('should emit sessionClosed when SSH session closes', () => {
      const handler = jest.fn();
      session.on('sessionClosed', handler);
      const sshSession = createMockSession();
      session.attachToTerminal(sshSession, {
        id: 'srv-1', name: 'Test', host: '10.0.0.1', port: 22,
        username: 'root', authType: 'password', variables: [],
        createdAt: new Date(), updatedAt: new Date(),
      });

      sshSession.emit('close');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('server context', () => {
    it('should set server context without terminal', () => {
      session.setServerContext({ name: 'Prod', host: '1.2.3.4', username: 'admin' });
      // Context is set (used internally in system prompt)
      // Verify no crash
      expect(session.getModel()).toBe('sonnet');
    });
  });

  describe('history management', () => {
    it('should start with empty history', () => {
      expect(session.getHistory()).toEqual([]);
    });

    it('should clear history', () => {
      const handler = jest.fn();
      session.on('historyCleared', handler);
      session.clearHistory();
      expect(handler).toHaveBeenCalled();
      expect(session.getHistory()).toEqual([]);
    });

    it('should clear terminal buffer', () => {
      const sshSession = createMockSession();
      session.attachToTerminal(sshSession, {
        id: 'srv-1', name: 'Test', host: '10.0.0.1', port: 22,
        username: 'root', authType: 'password', variables: [],
        createdAt: new Date(), updatedAt: new Date(),
      });
      sshSession.emit('data', 'some output');
      expect(session.getTerminalBuffer()).toBe('some output');

      session.clearTerminalBuffer();
      expect(session.getTerminalBuffer()).toBe('');
    });
  });

  describe('configuration', () => {
    it('should accept custom max tokens', () => {
      const s = new InteractiveClaudeSession({ apiKey: 'key', maxTokens: 4096 });
      expect(s.getModel()).toBe('sonnet'); // constructed without error
    });

    it('should accept custom history limit', () => {
      const s = new InteractiveClaudeSession({ apiKey: 'key', maxHistoryMessages: 5 });
      expect(s.getModel()).toBe('sonnet');
    });
  });
});
