/**
 * Transport for the hub simulator, over a WebSocket.
 *
 * Binary messages carry protocol frames, byte for byte what Web Bluetooth
 * would carry. Text messages carry the simulator's narration and telemetry,
 * which no real hub can provide -- they are handed to `onNarration` and never
 * mixed into the protocol stream.
 */

export class SimulatorTransport {
  name = 'the simulator';
  onData = () => {};
  onNarration = () => {};
  onClose = () => {};

  #socket = null;

  constructor(url = 'ws://127.0.0.1:8765') {
    this.url = url;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        this.#socket = socket;
        resolve();
      };
      socket.onerror = () =>
        reject(
          new Error(
            `Could not reach the simulator at ${this.url}. ` +
              'Start it with: python3 -m spike_sim',
          ),
        );
      socket.onclose = () => {
        this.#socket = null;
        this.onClose();
      };
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            this.onNarration(JSON.parse(event.data));
          } catch {
            // the simulator only ever sends JSON here; ignore anything else
          }
        } else {
          this.onData(new Uint8Array(event.data));
        }
      };
    });
  }

  send(bytes) {
    if (!this.#socket) throw new Error('The simulator is not connected.');
    this.#socket.send(bytes);
  }

  /** Simulator-only commands: reposition the robot, press a sensor, and so on. */
  command(payload) {
    this.#socket?.send(JSON.stringify(payload));
  }

  async disconnect() {
    this.#socket?.close();
    this.#socket = null;
  }
}
