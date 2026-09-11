/**
 * The WebSocket transport, against a live simulator.
 *
 * `hub-client.test.js` drives the same client over a TCP socket, which proves
 * the protocol logic. This file covers the pipe the browser actually uses:
 * the simulator's hand-rolled RFC 6455 implementation, binary frames carrying
 * protocol messages, and text frames carrying narration on the same socket.
 *
 * Without this, the first time that code path ran would be the first time a
 * student clicked "Connect to simulator".
 *
 * Node 22 has a global WebSocket. Node 20 has one behind
 * `--experimental-websocket`, so these are skipped there rather than failing.
 */

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { HubClient } from '../src/transport/hub-client.js';
import { SimulatorTransport } from '../src/transport/websocket.js';
import { block, codeFor, num, str } from './helpers.js';

const SIMULATOR_DIR = fileURLToPath(new URL('../../spike-sim', import.meta.url));
const hasWebSocket = typeof globalThis.WebSocket === 'function';

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

describe(
  'SimulatorTransport over a real WebSocket',
  {
    skip: hasWebSocket
      ? false
      : 'no global WebSocket (Node 20 needs --experimental-websocket)',
  },
  () => {
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

    it('completes the handshake and negotiates hub limits', async () => {
      const transport = new SimulatorTransport(`ws://127.0.0.1:${port}`);
      const client = new HubClient(transport);

      const info = await client.connect();
      assert.equal(client.connected, true);
      assert.equal(info.maxChunkSize % 4, 0);

      await client.disconnect();
    });

    it('runs a program and hears its printed output back', async () => {
      const transport = new SimulatorTransport(`ws://127.0.0.1:${port}`);
      const client = new HubClient(transport);
      await client.connect();

      const printed = [];
      client.on('console', (text) => printed.push(text.trim()));

      const started = nextEvent(client, 'program', (state) => state.running === true);
      await client.run(
        codeFor(
          block('spike_print', { values: { TEXT: str('over the websocket') } }),
          block('spike_move_for', {
            fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
            values: { AMOUNT: num(10) },
          }),
        ),
      );
      await started;
      await nextEvent(client, 'program', (state) => state.running === false);

      assert.deepEqual(printed, ['over the websocket']);
      await client.disconnect();
    });

    it('delivers narration on the same socket as the protocol', async () => {
      // Binary frames carry the protocol, text frames carry plain-language
      // narration. Mixing them up would either corrupt the protocol stream or
      // leave the student with nothing to listen to.
      const transport = new SimulatorTransport(`ws://127.0.0.1:${port}`);
      const narration = [];
      transport.onNarration = (payload) => narration.push(payload);

      const client = new HubClient(transport);
      await client.connect();

      const started = nextEvent(client, 'program', (state) => state.running === true);
      await client.run(
        codeFor(
          block('spike_move_for', {
            fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
            values: { AMOUNT: num(15) },
          }),
        ),
      );
      await started;
      await nextEvent(client, 'program', (state) => state.running === false);

      const hello = narration.find((entry) => entry.type === 'hello');
      assert.ok(hello, 'the simulator should describe the mat on connect');
      assert.ok(hello.world.width_mm > 0);

      const spoken = narration
        .filter((entry) => entry.type === 'event')
        .map((entry) => entry.message);
      assert.ok(
        spoken.some((line) => /The robot drove 15 centimetres/.test(line)),
        `expected the drive to be narrated, got: ${spoken.join(' | ')}`,
      );

      await client.disconnect();
    });

    it('handles a program larger than one chunk', async () => {
      // Uploads split on max_chunk_size with a chained CRC, and WebSocket
      // frames are not the same size as protocol frames. A long program
      // exercises both splits at once.
      const transport = new SimulatorTransport(`ws://127.0.0.1:${port}`);
      const client = new HubClient(transport);
      await client.connect();

      const manyBlocks = Array.from({ length: 40 }, (_, index) =>
        block('spike_print', { values: { TEXT: str(`line ${index}`) } }),
      );
      const code = codeFor(...manyBlocks);
      assert.ok(
        code.length > client.info.maxChunkSize,
        'the test program needs to exceed one chunk to be worth running',
      );

      const printed = [];
      client.on('console', (text) => printed.push(text.trim()));

      const started = nextEvent(client, 'program', (state) => state.running === true);
      await client.run(code);
      await started;
      await nextEvent(client, 'program', (state) => state.running === false);

      assert.equal(printed.length, 40);
      assert.equal(printed[0], 'line 0');
      assert.equal(printed.at(-1), 'line 39');

      await client.disconnect();
    });
  },
);
