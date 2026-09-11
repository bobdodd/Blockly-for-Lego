/**
 * Talking to a hub.
 *
 * `HubClient` owns the conversation -- framing, request/response pairing,
 * chunked upload -- and knows nothing about how the bytes travel. A transport
 * supplies `connect`, `send`, `disconnect` and an `onData` callback; the
 * simulator (WebSocket) and a real hub (Web Bluetooth) differ only there.
 *
 * That split is the point. The bytes are identical either way, so a program
 * that works against the simulator is exercising the same client code that
 * will drive the hardware.
 */

import * as cobs from '../protocol/cobs.js';
import { crc } from '../protocol/crc32.js';
import * as messages from '../protocol/messages.js';

const RESPONSE_TIMEOUT_MS = 5000;

/** Minimal event emitter, so the UI can subscribe without a framework. */
class Emitter {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.#handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        // A failing listener must not take down the connection to the robot.
        console.error(`Error in "${event}" listener:`, error);
      }
    }
  }
}

export class HubClient extends Emitter {
  #transport;
  #buffer = new Uint8Array(0);
  #pending = new Map();
  #info = null;
  #running = false;

  constructor(transport) {
    super();
    this.#transport = transport;
    transport.onData = (bytes) => this.#receive(bytes);
  }

  get name() {
    return this.#transport.name;
  }

  get connected() {
    return this.#info !== null;
  }

  get running() {
    return this.#running;
  }

  /** Hub limits, available once connected. */
  get info() {
    return this.#info;
  }

  // -- connection ---------------------------------------------------------

  async connect() {
    await this.#transport.connect();

    // The hub's limits are not optional: max_chunk_size governs the upload and
    // max_packet_size governs how a frame is split over the link.
    this.#info = await this.#request(messages.infoRequest(), 'InfoResponse');
    this.emit('status', { state: 'connected', info: this.#info, name: this.name });

    await this.#request(
      messages.deviceNotificationRequest(200),
      'DeviceNotificationResponse',
    );
    return this.#info;
  }

  async disconnect() {
    this.#info = null;
    this.#running = false;
    await this.#transport.disconnect?.();
    this.emit('status', { state: 'disconnected' });
  }

  // -- programs -----------------------------------------------------------

  /**
   * Send a program to the hub and start it.
   * @param {string} source SPIKE MicroPython
   * @param {number} [slot] one of the hub's twenty program slots
   */
  async run(source, slot = 0) {
    if (!this.connected) throw new Error('Connect to a hub first.');

    const program = new TextEncoder().encode(source);
    const programCrc = crc(program);

    // An empty slot reports failure here, which is not an error worth showing.
    await this.#request(messages.clearSlotRequest(slot), 'ClearSlotResponse').catch(
      () => undefined,
    );

    const started = await this.#request(
      messages.startFileUploadRequest('program.py', slot, programCrc),
      'StartFileUploadResponse',
    );
    if (!started.success) throw new Error('The hub refused the program upload.');

    const chunkSize = this.#info.maxChunkSize;
    let running = 0;
    for (let offset = 0; offset < program.length; offset += chunkSize) {
      const chunk = program.subarray(offset, offset + chunkSize);
      running = crc(chunk, running);
      const response = await this.#request(
        messages.transferChunkRequest(running, chunk),
        'TransferChunkResponse',
      );
      if (!response.success) {
        throw new Error(
          `The program was corrupted on its way to the hub ` +
            `(chunk starting at byte ${offset}).`,
        );
      }
      this.emit('upload', { sent: Math.min(offset + chunk.length, program.length), total: program.length });
    }

    const flow = await this.#request(
      messages.programFlowRequest(false, slot),
      'ProgramFlowResponse',
    );
    if (!flow.success) throw new Error('The hub would not start the program.');
    return true;
  }

  /** Stop whatever is running. */
  async stop(slot = 0) {
    if (!this.connected) return;
    await this.#request(messages.programFlowRequest(true, slot), 'ProgramFlowResponse');
  }

  // -- plumbing -----------------------------------------------------------

  #send(payload) {
    const frame = cobs.pack(payload);
    const packetSize = this.#info?.maxPacketSize ?? frame.length;
    // A frame longer than one packet is split; the hub reassembles it.
    for (let offset = 0; offset < frame.length; offset += packetSize) {
      this.#transport.send(frame.subarray(offset, offset + packetSize));
    }
  }

  #request(payload, expected) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(expected);
        reject(new Error(`The hub did not answer with a ${expected} in time.`));
      }, RESPONSE_TIMEOUT_MS);

      this.#pending.set(expected, { resolve, reject, timer });
      try {
        this.#send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(expected);
        reject(error);
      }
    });
  }

  /**
   * Accept a read from the transport.
   *
   * Buffering is not optional even though LEGO's example client skips it: a
   * link may split one frame across reads or deliver several in one.
   */
  #receive(bytes) {
    const combined = new Uint8Array(this.#buffer.length + bytes.length);
    combined.set(this.#buffer);
    combined.set(bytes, this.#buffer.length);

    let start = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] !== cobs.DELIMITER) continue;
      const frame = combined.subarray(start, i + 1);
      start = i + 1;
      if (frame.length > 1) this.#handleFrame(frame);
    }
    this.#buffer = combined.subarray(start);
  }

  #handleFrame(frame) {
    let message;
    try {
      message = messages.decode(cobs.unpack(frame));
    } catch (error) {
      this.emit('error', new Error(`Could not read a message from the hub: ${error.message}`));
      return;
    }

    const waiting = this.#pending.get(message.type);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.#pending.delete(message.type);
      waiting.resolve(message);
      return;
    }

    switch (message.type) {
      case 'ConsoleNotification':
        this.emit('console', message.text);
        break;
      case 'ProgramFlowNotification':
        this.#running = !message.stop;
        this.emit('program', { running: this.#running });
        break;
      case 'DeviceNotification':
        this.emit('telemetry', message.devices);
        break;
      case 'Unknown':
        this.emit('error', new Error(`The hub sent message 0x${message.id.toString(16)}, which this editor does not understand.`));
        break;
      default:
        // an unrequested response; nothing is waiting for it
        break;
    }
  }
}
