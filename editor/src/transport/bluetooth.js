/**
 * Transport for a real SPIKE Prime hub, over Web Bluetooth.
 *
 * Service and characteristic UUIDs come from LEGO's published protocol
 * documentation: https://lego.github.io/spike-prime-docs/
 *
 * Web Bluetooth exists in Chrome and Edge on Windows, macOS, Linux and
 * ChromeOS. It does not exist in Safari or Firefox, and not on iOS or iPadOS
 * at all -- see `isSupported`.
 */

export const SPIKE_SERVICE = '0000fd02-0000-1000-8000-00805f9b34fb';
export const SPIKE_RX_CHARACTERISTIC = '0000fd02-0001-1000-8000-00805f9b34fb';
export const SPIKE_TX_CHARACTERISTIC = '0000fd02-0002-1000-8000-00805f9b34fb';

export function isSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export class BluetoothTransport {
  name = 'a SPIKE Prime hub';
  onData = () => {};
  onClose = () => {};

  #device = null;
  #rx = null;

  async connect() {
    if (!isSupported()) {
      throw new Error(
        'This browser cannot connect to a hub over Bluetooth. ' +
          'Use Chrome or Edge on Windows, macOS, Linux or ChromeOS, ' +
          'or run the simulator instead.',
      );
    }

    // Must be called from a user gesture, or the browser refuses the prompt.
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SPIKE_SERVICE] }],
    });
    this.name = this.#device.name || 'a SPIKE Prime hub';

    this.#device.addEventListener('gattserverdisconnected', () => {
      this.#rx = null;
      this.onClose();
    });

    const server = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(SPIKE_SERVICE);
    this.#rx = await service.getCharacteristic(SPIKE_RX_CHARACTERISTIC);

    const tx = await service.getCharacteristic(SPIKE_TX_CHARACTERISTIC);
    tx.addEventListener('characteristicvaluechanged', (event) => {
      this.onData(new Uint8Array(event.target.value.buffer));
    });
    await tx.startNotifications();
  }

  send(bytes) {
    if (!this.#rx) throw new Error('The hub is not connected.');
    // Without a response the writes queue in order and keep up with uploads.
    return this.#rx.writeValueWithoutResponse(bytes);
  }

  async disconnect() {
    this.#device?.gatt?.disconnect();
    this.#device = null;
    this.#rx = null;
  }
}
