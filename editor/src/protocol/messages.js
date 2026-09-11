/**
 * SPIKE Prime protocol messages, from the client's point of view.
 *
 * Encoders build the requests a client sends; `decode` parses everything the
 * hub sends back. Layouts follow LEGO's `messages.py` and the protocol
 * documentation at https://lego.github.io/spike-prime-docs/
 *
 * Checked against vectors generated from that Python implementation --
 * see `test/protocol.test.js`.
 */

export const MessageId = {
  InfoRequest: 0x00,
  InfoResponse: 0x01,
  StartFileUploadRequest: 0x0c,
  StartFileUploadResponse: 0x0d,
  TransferChunkRequest: 0x10,
  TransferChunkResponse: 0x11,
  ProgramFlowRequest: 0x1e,
  ProgramFlowResponse: 0x1f,
  ProgramFlowNotification: 0x20,
  ConsoleNotification: 0x21,
  DeviceNotificationRequest: 0x28,
  DeviceNotificationResponse: 0x29,
  DeviceNotification: 0x3c,
  ClearSlotRequest: 0x46,
  ClearSlotResponse: 0x47,
};

const STATUS_RESPONSES = {
  [MessageId.StartFileUploadResponse]: 'StartFileUploadResponse',
  [MessageId.TransferChunkResponse]: 'TransferChunkResponse',
  [MessageId.ProgramFlowResponse]: 'ProgramFlowResponse',
  [MessageId.DeviceNotificationResponse]: 'DeviceNotificationResponse',
  [MessageId.ClearSlotResponse]: 'ClearSlotResponse',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

// --------------------------------------------------------------------------
// client -> hub
// --------------------------------------------------------------------------

export function infoRequest() {
  return Uint8Array.of(MessageId.InfoRequest);
}

export function clearSlotRequest(slot) {
  return Uint8Array.of(MessageId.ClearSlotRequest, slot);
}

export function startFileUploadRequest(fileName, slot, fileCrc) {
  const name = encoder.encode(fileName);
  if (name.length > 31) {
    throw new RangeError(
      `File name is ${name.length} bytes encoded; the hub allows at most 31.`,
    );
  }
  const bytes = new Uint8Array(1 + name.length + 1 + 1 + 4);
  const view = new DataView(bytes.buffer);
  bytes[0] = MessageId.StartFileUploadRequest;
  bytes.set(name, 1);
  bytes[1 + name.length] = 0x00; // NUL terminator
  bytes[2 + name.length] = slot;
  view.setUint32(3 + name.length, fileCrc >>> 0, true);
  return bytes;
}

export function transferChunkRequest(runningCrc, chunk) {
  const bytes = new Uint8Array(1 + 4 + 2 + chunk.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = MessageId.TransferChunkRequest;
  view.setUint32(1, runningCrc >>> 0, true);
  view.setUint16(5, chunk.length, true);
  bytes.set(chunk, 7);
  return bytes;
}

export function programFlowRequest(stop, slot) {
  return Uint8Array.of(MessageId.ProgramFlowRequest, stop ? 1 : 0, slot);
}

export function deviceNotificationRequest(intervalMs) {
  const bytes = new Uint8Array(3);
  bytes[0] = MessageId.DeviceNotificationRequest;
  new DataView(bytes.buffer).setUint16(1, intervalMs, true);
  return bytes;
}

// --------------------------------------------------------------------------
// hub -> client
// --------------------------------------------------------------------------

/**
 * Parse a message payload from the hub.
 * @param {Uint8Array} payload
 * @returns {{type: string, [key: string]: any}}
 */
export function decode(payload) {
  if (!payload.length) throw new RangeError('Empty message from the hub.');

  const id = payload[0];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  if (id === MessageId.InfoResponse) {
    return {
      type: 'InfoResponse',
      rpcMajor: view.getUint8(1),
      rpcMinor: view.getUint8(2),
      rpcBuild: view.getUint16(3, true),
      firmwareMajor: view.getUint8(5),
      firmwareMinor: view.getUint8(6),
      firmwareBuild: view.getUint16(7, true),
      maxPacketSize: view.getUint16(9, true),
      maxMessageSize: view.getUint16(11, true),
      maxChunkSize: view.getUint16(13, true),
      productGroupDevice: view.getUint16(15, true),
    };
  }

  if (STATUS_RESPONSES[id]) {
    return {
      type: STATUS_RESPONSES[id],
      id,
      // 0x00 means success; anything else is a failure code
      success: view.getUint8(1) === 0x00,
    };
  }

  if (id === MessageId.ProgramFlowNotification) {
    return { type: 'ProgramFlowNotification', stop: view.getUint8(1) !== 0 };
  }

  if (id === MessageId.ConsoleNotification) {
    let end = payload.length;
    while (end > 1 && payload[end - 1] === 0x00) end--; // strip NUL padding
    return { type: 'ConsoleNotification', text: decoder.decode(payload.subarray(1, end)) };
  }

  if (id === MessageId.DeviceNotification) {
    const size = view.getUint16(1, true);
    return {
      type: 'DeviceNotification',
      devices: decodeDeviceEntries(payload.subarray(3, 3 + size)),
    };
  }

  return { type: 'Unknown', id, payload };
}

/**
 * Walk the concatenated device entries inside a DeviceNotification.
 * @param {Uint8Array} data
 */
function decodeDeviceEntries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const devices = [];
  let offset = 0;

  while (offset < data.length) {
    const id = data[offset];
    const spec = DEVICE_ENTRIES[id];
    if (!spec) {
      // Stop rather than guess: a misaligned read would silently produce
      // plausible-looking garbage for every entry that follows.
      devices.push({ kind: 'unknown', id, atOffset: offset });
      break;
    }
    devices.push(spec.read(view, data, offset));
    offset += spec.size;
  }

  return devices;
}

const DEVICE_ENTRIES = {
  0x00: {
    size: 2,
    read: (view, _data, at) => ({ kind: 'battery', percent: view.getUint8(at + 1) }),
  },
  0x01: {
    size: 21,
    read: (view, _data, at) => ({
      kind: 'imu',
      faceUp: view.getUint8(at + 1),
      yawFace: view.getUint8(at + 2),
      // the hub reports orientation in decidegrees
      yaw: view.getInt16(at + 3, true) / 10,
      pitch: view.getInt16(at + 5, true) / 10,
      roll: view.getInt16(at + 7, true) / 10,
      acceleration: [
        view.getInt16(at + 9, true),
        view.getInt16(at + 11, true),
        view.getInt16(at + 13, true),
      ],
      gyroscope: [
        view.getInt16(at + 15, true),
        view.getInt16(at + 17, true),
        view.getInt16(at + 19, true),
      ],
    }),
  },
  0x02: {
    size: 26,
    read: (_view, data, at) => ({
      kind: 'display5x5',
      pixels: Array.from(data.subarray(at + 1, at + 26)),
    }),
  },
  0x0a: {
    size: 12,
    read: (view, _data, at) => ({
      kind: 'motor',
      port: view.getUint8(at + 1),
      deviceType: view.getUint8(at + 2),
      absolutePosition: view.getInt16(at + 3, true),
      power: view.getInt16(at + 5, true),
      speed: view.getInt8(at + 7),
      position: view.getInt32(at + 8, true),
    }),
  },
  0x0b: {
    size: 4,
    read: (view, _data, at) => ({
      kind: 'force',
      port: view.getUint8(at + 1),
      force: view.getUint8(at + 2),
      pressed: view.getUint8(at + 3) !== 0,
    }),
  },
  0x0c: {
    size: 9,
    read: (view, _data, at) => ({
      kind: 'color',
      port: view.getUint8(at + 1),
      // signed: -1 means no colour detected
      color: view.getInt8(at + 2),
      rgb: [
        view.getUint16(at + 3, true),
        view.getUint16(at + 5, true),
        view.getUint16(at + 7, true),
      ],
    }),
  },
  0x0d: {
    size: 4,
    read: (view, _data, at) => ({
      kind: 'distance',
      port: view.getUint8(at + 1),
      // -1 means nothing in range
      distanceMm: view.getInt16(at + 2, true),
    }),
  },
  0x0e: {
    size: 11,
    read: (_view, data, at) => ({
      kind: 'matrix3x3',
      port: data[at + 1],
      pixels: Array.from(data.subarray(at + 2, at + 11)),
    }),
  },
};

export const PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Colour ids as reported by the colour sensor, named for narration. */
export const COLOR_NAMES = {
  '-1': 'no colour',
  0: 'black',
  1: 'magenta',
  2: 'purple',
  3: 'blue',
  4: 'azure',
  5: 'turquoise',
  6: 'green',
  7: 'yellow',
  8: 'orange',
  9: 'red',
  10: 'white',
};
