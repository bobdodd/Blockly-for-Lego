/**
 * The browser client's protocol layer, checked against LEGO's implementation.
 *
 * Every vector in `vectors.json` was produced by the vendored LEGO codec (see
 * `scripts/gen-vectors.py`). The simulator is tested against that same codec
 * in Python, so passing here means the editor, the simulator and a real hub
 * all agree on the bytes.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import * as cobs from '../src/protocol/cobs.js';
import { crc } from '../src/protocol/crc32.js';
import * as messages from '../src/protocol/messages.js';

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./vectors.json', import.meta.url)), 'utf8'),
);

const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
const toHex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('COBS framing', () => {
  for (const [index, vector] of vectors.cobs.entries()) {
    it(`packs case ${index} (${vector.payload.length / 2} bytes) as LEGO does`, () => {
      assert.equal(toHex(cobs.pack(fromHex(vector.payload))), vector.framed);
    });

    it(`unpacks case ${index} back to the original payload`, () => {
      assert.equal(toHex(cobs.unpack(fromHex(vector.framed))), vector.payload);
    });
  }

  it('never emits the delimiter inside a frame', () => {
    for (const vector of vectors.cobs) {
      const frame = cobs.pack(fromHex(vector.payload));
      const inner = frame.subarray(0, frame.length - 1);
      assert.ok(
        !inner.includes(cobs.DELIMITER),
        `frame for ${vector.payload} contains the delimiter before its end`,
      );
      assert.equal(frame[frame.length - 1], cobs.DELIMITER);
    }
  });

  it('tolerates the unused leading priority byte', () => {
    const payload = Uint8Array.of(0x00);
    const framed = cobs.pack(payload);
    const withPriority = Uint8Array.of(0x01, ...framed);
    assert.equal(toHex(cobs.unpack(withPriority)), toHex(payload));
  });
});

describe('CRC-32', () => {
  for (const vector of vectors.crc) {
    const label = vector.data ? `${vector.data.length / 2} bytes` : 'empty';
    it(`matches LEGO for ${label}, seed 0x${vector.seed.toString(16)}`, () => {
      assert.equal(crc(fromHex(vector.data), vector.seed), vector.expected);
    });
  }

  it('chains across 4-aligned chunks to the whole-file value', () => {
    // This is the property that makes chunked upload work at all, and the
    // reason max_chunk_size must be a multiple of 4.
    const file = new Uint8Array(1000);
    for (let i = 0; i < file.length; i++) file[i] = (i * 7) & 0xff;

    const whole = crc(file);
    let running = 0;
    for (let offset = 0; offset < file.length; offset += 512) {
      running = crc(file.subarray(offset, offset + 512), running);
    }
    assert.equal(running, whole);
  });

  it('does NOT chain when chunks are not 4-aligned', () => {
    // Documenting the trap: a client that picks its own unaligned chunk size
    // produces a running CRC the hub will reject.
    const file = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    let running = 0;
    for (let offset = 0; offset < file.length; offset += 100 - 1) {
      running = crc(file.subarray(offset, offset + 99), running);
    }
    assert.notEqual(running, crc(file));
  });
});

describe('requests the client sends', () => {
  const expected = Object.fromEntries(
    vectors.requests.map((vector) => [vector.name, vector.serialized]),
  );
  const hello = fromHex(
    vectors.requests.find((v) => v.name === 'TransferChunkRequest').serialized,
  ).subarray(7);

  it('InfoRequest', () => {
    assert.equal(toHex(messages.infoRequest()), expected.InfoRequest);
  });

  it('ClearSlotRequest', () => {
    assert.equal(toHex(messages.clearSlotRequest(3)), expected.ClearSlotRequest);
  });

  it('StartFileUploadRequest', () => {
    assert.equal(
      toHex(messages.startFileUploadRequest('program.py', 0, crc(hello))),
      expected.StartFileUploadRequest,
    );
  });

  it('TransferChunkRequest', () => {
    assert.equal(
      toHex(messages.transferChunkRequest(crc(hello), hello)),
      expected.TransferChunkRequest,
    );
  });

  it('ProgramFlowRequest, start and stop', () => {
    assert.equal(
      toHex(messages.programFlowRequest(false, 0)),
      expected.ProgramFlowRequestStart,
    );
    assert.equal(
      toHex(messages.programFlowRequest(true, 0)),
      expected.ProgramFlowRequestStop,
    );
  });

  it('DeviceNotificationRequest', () => {
    assert.equal(
      toHex(messages.deviceNotificationRequest(100)),
      expected.DeviceNotificationRequest,
    );
  });

  it('refuses a file name the hub could not store', () => {
    assert.throws(() => messages.startFileUploadRequest('x'.repeat(32), 0, 0), RangeError);
  });
});

describe('responses the client receives', () => {
  const payloads = Object.fromEntries(
    vectors.responses.map((vector) => [vector.name, fromHex(vector.payload)]),
  );
  const decode = (name) => messages.decode(payloads[name]);

  it('InfoResponse', () => {
    const info = decode('InfoResponse');
    assert.equal(info.type, 'InfoResponse');
    assert.deepEqual(
      [info.rpcMajor, info.rpcMinor, info.rpcBuild],
      [3, 1, 2],
    );
    assert.deepEqual(
      [info.firmwareMajor, info.firmwareMinor, info.firmwareBuild],
      [4, 5, 6],
    );
    assert.equal(info.maxPacketSize, 244);
    assert.equal(info.maxMessageSize, 1024);
    assert.equal(info.maxChunkSize, 512);
  });

  it('status responses carry success and failure', () => {
    assert.equal(decode('StartFileUploadResponseOk').success, true);
    assert.equal(decode('TransferChunkResponseFail').success, false);
    assert.equal(decode('ProgramFlowResponseOk').success, true);
    assert.equal(decode('ClearSlotResponseFail').success, false);
  });

  it('ProgramFlowNotification', () => {
    assert.equal(decode('ProgramFlowNotificationStart').stop, false);
    assert.equal(decode('ProgramFlowNotificationStop').stop, true);
  });

  it('ConsoleNotification, including non-ASCII output', () => {
    assert.equal(decode('ConsoleNotification').text.trim(), 'Hello, world!');
    assert.equal(decode('ConsoleNotificationUnicode').text.trim(), 'café — 25°');
  });

  it('DeviceNotification decodes every entry in order', () => {
    const { devices } = decode('DeviceNotification');
    assert.deepEqual(
      devices.map((device) => device.kind),
      [
        'battery', 'imu', 'display5x5', 'motor', 'motor',
        'color', 'distance', 'force', 'matrix3x3',
      ],
    );

    const [battery, imu, display, motorA, motorB, color, distance, force, matrix] = devices;
    assert.equal(battery.percent, 87);
    assert.equal(imu.yaw, 90);
    assert.equal(imu.pitch, -15);
    assert.deepEqual(imu.acceleration, [0, 0, 1000]);
    assert.deepEqual(imu.gyroscope, [1, -2, 3]);
    assert.equal(display.pixels.length, 25);

    assert.equal(motorA.port, 0);
    assert.equal(motorA.position, 1234);
    assert.equal(motorA.absolutePosition, -90);
    assert.equal(motorA.speed, 50);
    assert.equal(motorB.position, -4321, 'negative positions must stay signed');
    assert.equal(motorB.power, -75);
    assert.equal(motorB.speed, -50);

    assert.equal(color.color, 9);
    assert.deepEqual(color.rgb, [200, 30, 30]);
    assert.equal(distance.distanceMm, 451);
    assert.equal(force.force, 33);
    assert.equal(force.pressed, true);
    assert.deepEqual(matrix.pixels, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('represents "nothing detected" as -1, not as a huge unsigned value', () => {
    const { devices } = decode('DeviceNotificationNothingInRange');
    assert.equal(devices[0].distanceMm, -1);
    assert.equal(devices[1].color, -1);
  });

  it('reports an unknown message rather than guessing', () => {
    assert.equal(messages.decode(Uint8Array.of(0xab, 0x00)).type, 'Unknown');
  });

  it('refuses an empty message', () => {
    assert.throws(() => messages.decode(new Uint8Array(0)), RangeError);
  });
});
