import { EventEmitter } from 'events';
import { AutoFillEngine } from '../autofill/AutoFillEngine';
import { ServerConnection, SSHSession } from '..';

function createMockSession(): SSHSession & EventEmitter {
  const emitter = new EventEmitter() as SSHSession & EventEmitter;
  emitter.id = 'test-session';
  emitter.write = jest.fn();
  emitter.resize = jest.fn();
  emitter.close = jest.fn();
  return emitter;
}

function makeServer(variables: ServerConnection['variables'] = []): ServerConnection {
  return {
    id: 'srv-1',
    name: 'Test',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    variables,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('AutoFillEngine', () => {
  let engine: AutoFillEngine;
  let session: SSHSession & EventEmitter;

  beforeEach(() => {
    engine = new AutoFillEngine();
    session = createMockSession();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should auto-fill when a custom trigger matches', () => {
    const server = makeServer([{
      id: 'v1',
      name: 'MY_VAR',
      description: 'test var',
      value: 'my-secret',
      triggers: [{ pattern: 'Enter password:', type: 'custom' }],
    }]);

    engine.attach(session, server);
    session.emit('data', 'Enter password:');

    expect(session.write).toHaveBeenCalledWith('my-secret\n');
  });

  it('should auto-fill using default triggers for SUDO_PASSWORD', () => {
    const server = makeServer([{
      id: 'v1',
      name: 'SUDO_PASSWORD',
      description: 'sudo',
      value: 'sudo-pass',
      triggers: [], // falls back to defaults
    }]);

    engine.attach(session, server);
    session.emit('data', '[sudo] password for user:');

    expect(session.write).toHaveBeenCalledWith('sudo-pass\n');
  });

  it('should not fill when no trigger matches', () => {
    const server = makeServer([{
      id: 'v1',
      name: 'MY_VAR',
      description: 'test',
      value: 'secret',
      triggers: [{ pattern: 'specific-prompt>', type: 'custom' }],
    }]);

    engine.attach(session, server);
    session.emit('data', 'some random output');

    expect(session.write).not.toHaveBeenCalled();
  });

  it('should debounce fills (500ms)', () => {
    const server = makeServer([{
      id: 'v1',
      name: 'MY_VAR',
      description: 'test',
      value: 'secret',
      triggers: [{ pattern: 'Password:', type: 'custom' }],
    }]);

    engine.attach(session, server);

    // First trigger
    session.emit('data', 'Password:');
    expect(session.write).toHaveBeenCalledTimes(1);

    // Immediate second trigger — should be debounced
    jest.advanceTimersByTime(100);
    session.emit('data', 'Password:');
    expect(session.write).toHaveBeenCalledTimes(1);

    // After debounce period
    jest.advanceTimersByTime(500);
    session.emit('data', 'Password:');
    expect(session.write).toHaveBeenCalledTimes(2);
  });

  it('should keep buffer under 500 chars', () => {
    const server = makeServer([{
      id: 'v1',
      name: 'MY_VAR',
      description: 'test',
      value: 'secret',
      triggers: [{ pattern: 'ENDMARKER', type: 'custom' }],
    }]);

    engine.attach(session, server);

    // Send a large chunk of data
    const longOutput = 'x'.repeat(1000);
    session.emit('data', longOutput);

    // Then a trigger — engine should still work (buffer trimmed)
    jest.advanceTimersByTime(600);
    session.emit('data', 'ENDMARKER');
    expect(session.write).toHaveBeenCalledWith('secret\n');
  });

  it('should handle server with no variables', () => {
    const server = makeServer([]);
    engine.attach(session, server);
    session.emit('data', 'Password:');
    expect(session.write).not.toHaveBeenCalled();
  });
});
