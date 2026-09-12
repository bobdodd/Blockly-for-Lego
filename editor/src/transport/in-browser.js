/**
 * Transport for the simulator running inside this browser.
 *
 * The fourth pipe the same protocol frames travel down, after Bluetooth, a
 * WebSocket and a plain socket. It exists so a copy of the editor served from
 * the web can still have a robot: a browser will not let a page reach a
 * simulator running on the reader's own machine, so the simulator comes to
 * the page instead.
 *
 * From `HubClient`'s point of view this is indistinguishable from the others —
 * `connect`, `send`, `disconnect`, `onData`. That is what keeps one simulator
 * rather than two: the hosted robot and the local one are the same Python,
 * reached differently.
 */

const WORKER_PATH = 'dist/simulator-worker.js';

/** Uint8Array to base64, and back. See the note in simulator-worker.js. */
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class InBrowserSimulatorTransport {
  name = 'the built-in simulator';
  onData = () => {};
  onNarration = () => {};
  onClose = () => {};

  /** Called with `{stage, detail}` while Python is downloading and starting. */
  onProgress = () => {};

  #worker = null;
  #ready = null;
  #matChange = null;
  #robotChange = null;

  /**
   * @param {{speed?: number, snapshotInterval?: number, indexURL?: string,
   *          mat?: string}} options
   */
  constructor({ speed = 1, snapshotInterval = 0.05, indexURL, mat = '', robot = '' } = {}) {
    // Listed one by one on purpose — a `...rest` here would take anything and
    // hide a typo — which means every new option has to be added in three
    // places, and `mat` was added at both ends and not in the middle. It went
    // in from the editor, came out of the worker, and was dropped here in
    // between, so every mat was the default one and nothing said otherwise.
    this.options = { speed, snapshotInterval, indexURL, mat, robot };
  }

  connect() {
    if (this.#ready) return this.#ready;

    this.#ready = new Promise((resolve, reject) => {
      const url = new URL(WORKER_PATH, document.baseURI);
      // A module worker: Pyodide ships as an ES module and cannot be loaded
      // by a classic worker's importScripts.
      this.#worker = new Worker(url, { type: 'module' });

      this.#worker.onerror = (event) => {
        reject(new Error(
          `The built-in simulator could not start: ${event.message ?? 'worker failed to load'}`,
        ));
      };

      this.#worker.onmessage = ({ data }) => {
        switch (data.type) {
          case 'progress':
            this.onProgress(data);
            break;

          case 'mat-ready':
            this.#matChange?.resolve(data.mat);
            this.#matChange = null;
            break;

          case 'robot-ready':
            this.#robotChange?.resolve(data.robot);
            this.#robotChange = null;
            break;

          case 'ready':
            // The mats the simulator actually has, so the editor's menu can
            // never offer one that is not there.
            this.catalogue = data.catalogue ?? [];
            resolve();
            break;

          case 'frame':
            this.onData(fromBase64(data.data));
            break;

          case 'message':
            try {
              this.onNarration(JSON.parse(data.data));
            } catch {
              // the worker only ever sends JSON here
            }
            break;

          case 'error':
            // Before "ready" this is a failure to start, and the promise is
            // still waiting on it. After, it is a fault in a running
            // simulator, which the editor reports without tearing down.
            this.#matChange?.reject(new Error(data.message));
            this.#matChange = null;
            this.#robotChange?.reject(new Error(data.message));
            this.#robotChange = null;
            reject(new Error(data.message));
            this.onProgress({ stage: 'error', detail: data.message });
            break;

          default:
            break;
        }
      };

      this.#worker.postMessage({
        type: 'start',
        speed: this.options.speed,
        snapshotInterval: this.options.snapshotInterval,
        mat: this.options.mat ?? '',
        robot: this.options.robot ?? '',
        ...(this.options.indexURL ? { indexURL: this.options.indexURL } : {}),
      });
    });

    return this.#ready;
  }

  /**
   * Lay out a different mat without starting over.
   *
   * Python is the expensive part of this and the mat is the cheap one, so the
   * worker keeps the first and rebuilds the second. Tearing the worker down
   * meant loading Python again every time a student tried another mat, which
   * is most of what a catalogue is for.
   */
  setMat(name) {
    if (!this.#worker) {
      this.options.mat = name;
      return Promise.resolve(name);
    }

    this.options.mat = name;
    return new Promise((resolve, reject) => {
      this.#matChange = { resolve, reject };
      this.#worker.postMessage({ type: 'mat', name });
    });
  }

  /** Rebuild the robot to a different set of measurements, on the same mat. */
  setRobot(name) {
    this.options.robot = name;
    if (!this.#worker) return Promise.resolve(name);

    return new Promise((resolve, reject) => {
      this.#robotChange = { resolve, reject };
      this.#worker.postMessage({ type: 'robot', name, mat: this.options.mat ?? '' });
    });
  }

  send(bytes) {
    this.#worker?.postMessage({ type: 'frame', data: toBase64(bytes) });
  }

  /** Simulator-only commands: place, reset, press, speed, describe. */
  command(payload) {
    this.#worker?.postMessage({ type: 'command', data: JSON.stringify(payload) });
  }

  async disconnect() {
    if (!this.#worker) return;
    // Terminate rather than wait: a program that never yields cannot answer,
    // and being able to stop one regardless is most of why this is a worker.
    this.#worker.postMessage({ type: 'stop' });
    this.#worker.terminate();
    this.#worker = null;
    this.#ready = null;
    this.onClose();
  }
}

/** Whether this browser can run the built-in simulator at all. */
export function isSupported() {
  return typeof Worker === 'function' && typeof WebAssembly === 'object';
}
