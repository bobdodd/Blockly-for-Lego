/**
 * HubClient against a live hub simulator.
 *
 * The generator tests prove the Python is right; these prove the editor can
 * actually deliver it. A real simulator process is started, and the same
 * client code the browser uses talks to it over a socket: info negotiation,
 * chunked upload with a running CRC, program start and stop, console output
 * and telemetry.
 *
 * The only thing swapped out is the pipe. In the browser that is a WebSocket
 * or Web Bluetooth; here it is a TCP socket, which the simulator serves on the
 * same port. The frames are identical.
 */

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { HubClient } from '../src/transport/hub-client.js';
import { block, codeFor, num, str } from './helpers.js';

const SIMULATOR_DIR = fileURLToPath(new URL('../../spike-sim', import.meta.url));

/** A transport over a plain TCP socket, standing in for the browser's. */
class NodeSocketTransport {
  name = 'the simulator over TCP';
  onData = () => {};

  constructor(port) {
    this.port = port;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect({ host: '127.0.0.1', port: this.port }, resolve);
      this.socket.on('data', (chunk) => this.onData(new Uint8Array(chunk)));
      this.socket.on('error', reject);
    });
  }

  send(bytes) {
    this.socket.write(Buffer.from(bytes));
  }

  async disconnect() {
    this.socket?.destroy();
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reachable = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (reachable) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The simulator never started listening on port ${port}.`);
}

const nextEvent = (client, event, predicate = () => true, timeoutMs = 20_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No "${event}" from the hub within ${timeoutMs}ms`)),
      timeoutMs,
    );
    const off = client.on(event, (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });

describe('HubClient against a running simulator', () => {
  let simulator;
  let port;

  before(async () => {
    port = await freePort();
    simulator = spawn(
      'python3',
      ['-m', 'spike_sim', '--port', String(port), '--speed', '50', '--quiet'],
      { cwd: SIMULATOR_DIR, stdio: 'ignore' },
    );
    await waitForPort(port);
  });

  after(() => {
    simulator?.kill();
  });

  it('negotiates the hub limits on connect', async () => {
    const client = new HubClient(new NodeSocketTransport(port));
    const info = await client.connect();

    assert.equal(client.connected, true);
    assert.ok(info.maxChunkSize > 0);
    assert.equal(
      info.maxChunkSize % 4,
      0,
      'an unaligned chunk size would break the running CRC',
    );
    assert.ok(info.maxPacketSize > 0 && info.maxPacketSize <= info.maxMessageSize);

    await client.disconnect();
  });

  it('uploads a generated program and receives its printed output', async () => {
    const client = new HubClient(new NodeSocketTransport(port));
    await client.connect();

    const code = codeFor(
      block('spike_print', { values: { TEXT: str('hello from the editor') } }),
      block('spike_move_for', {
        fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
        values: { AMOUNT: num(10) },
      }),
      block('spike_print', { values: { TEXT: str('arrived') } }),
    );

    const printed = [];
    client.on('console', (text) => printed.push(text.trim()));

    const started = nextEvent(client, 'program', (state) => state.running === true);
    await client.run(code);
    await started;

    await nextEvent(client, 'program', (state) => state.running === false);

    assert.deepEqual(printed, ['hello from the editor', 'arrived']);
    await client.disconnect();
  });

  it('reports upload progress', async () => {
    const client = new HubClient(new NodeSocketTransport(port));
    await client.connect();

    const progress = [];
    client.on('upload', (update) => progress.push(update));
    await client.run(codeFor(block('spike_display_clear')));

    assert.ok(progress.length >= 1);
    const last = progress.at(-1);
    assert.equal(last.sent, last.total, 'the final update should report the whole file');

    await client.stop();
    await client.disconnect();
  });

  it('streams live sensor telemetry', async () => {
    // This is what lets the editor speak sensor values aloud, which is the
    // capability the official app cannot offer a blind student.
    const client = new HubClient(new NodeSocketTransport(port));
    await client.connect();

    const devices = await nextEvent(client, 'telemetry');
    const kinds = devices.map((device) => device.kind);

    assert.ok(kinds.includes('battery'));
    assert.ok(kinds.includes('motor'));
    assert.ok(kinds.includes('color'));
    assert.ok(kinds.includes('distance'));

    const colour = devices.find((device) => device.kind === 'color');
    assert.ok(colour.color >= -1 && colour.color <= 10);

    await client.disconnect();
  });

  it('stops a running program on request', async () => {
    const client = new HubClient(new NodeSocketTransport(port));
    await client.connect();

    const forever = codeFor(
      block('spike_move_start', { fields: { DIRECTION: 'FORWARD' } }),
      block('controls_whileUntil', {
        fields: { MODE: 'WHILE' },
        values: { BOOL: block('logic_boolean', { fields: { BOOL: 'TRUE' } }) },
        statements: { DO: [block('spike_wait_seconds', { values: { SECONDS: num(0.1) } })] },
      }),
    );

    // Subscribe before running: the hub announces the program has started
    // while client.run() is still in flight, so listening afterwards can miss
    // the notification entirely.
    const started = nextEvent(client, 'program', (state) => state.running === true);
    await client.run(forever);
    await started;

    const stopped = nextEvent(client, 'program', (state) => state.running === false);
    await client.stop();
    await stopped;

    assert.equal(client.running, false);
    await client.disconnect();
  });

  it('refuses to run before it is connected', async () => {
    const client = new HubClient(new NodeSocketTransport(port));
    await assert.rejects(() => client.run('print("nope")'), /Connect to a hub first/);
  });
});
