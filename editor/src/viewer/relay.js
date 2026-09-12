/**
 * Passing the simulator's messages to another window.
 *
 * The robot view can be opened on its own — a projector, or a second screen,
 * with the editor left full size on a laptop. That window was written when
 * the only simulator was one you started yourself, and it connected to it
 * over a WebSocket like any other client.
 *
 * The built-in simulator has no socket. It runs inside a worker belonging to
 * the editor's window, and a second window cannot reach a worker it does not
 * own. So the pop-out connected to `ws://127.0.0.1:8765`, found nothing
 * there, and sat looking at an empty mat — which is what a robot view with no
 * robot looks like, and gives no hint that the reason is architectural.
 *
 * This is the missing pipe: the editor already receives every message, and
 * repeats them on a channel any window on the same origin can listen to. The
 * payloads are passed on untouched, so the pop-out cannot tell — and must not
 * care — which kind of simulator produced them.
 *
 * A `BroadcastChannel` rather than `postMessage` to the opener, because it
 * survives the pop-out being reloaded, needs no handle kept on either side,
 * and lets a second screen and a projector both watch the same robot.
 */

const CHANNEL = 'blockly-for-lego.telemetry';

/** Sent by a viewer that has just opened and missed the mat. */
export const WANTS_HELLO = '__wants-hello__';

/** Sent by a viewer asking the editor to do something it cannot do itself. */
export const ASKS = '__asks__';

/** Sent by the editor so a viewer can show what happened. */
export const TELLS = '__tells__';

export function isSupported() {
  return typeof BroadcastChannel === 'function';
}

/**
 * The editor's end: repeat everything, and answer a latecomer.
 *
 * @param {() => object|null} lastHello what to send a viewer that just opened,
 *   because the mat was described before it existed
 * @param {(action: string) => void} [onAsk] a viewer asking for something only
 *   the editor can do — running a program, which needs the blocks
 */
export function broadcast(lastHello = () => null, onAsk = () => {}) {
  if (!isSupported()) return { send() {}, tell() {}, close() {} };

  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (data?.type === WANTS_HELLO) {
      // A viewer opened after the simulator connected has missed the one
      // message that describes the mat, and nothing repeats it on its own.
      const hello = lastHello();
      if (hello) channel.postMessage(hello);
      return;
    }
    if (data?.type === ASKS) onAsk(data.action);
  };

  return {
    /** Say what happened, so the window that asked can show it. */
    tell(text) {
      try {
        channel.postMessage({ type: TELLS, text });
      } catch {
        // see send()
      }
    },

    send(payload) {
      try {
        channel.postMessage(payload);
      } catch {
        // A payload that will not clone is not worth taking the editor down
        // for; the pop-out simply misses that one message.
      }
    },
    close() {
      channel.close();
    },
  };
}

/**
 * A viewer's end: listen, and ask for the mat.
 *
 * @param {(payload: object) => void} onMessage the simulator's own messages
 * @param {(text: string) => void} [onTell] what the editor says happened
 */
export function listen(onMessage, onTell = () => {}) {
  if (!isSupported()) return { ask() {}, close() {} };

  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (!data) return;
    // Our own request, and the editor's answer to somebody's.
    if (data.type === WANTS_HELLO || data.type === ASKS) return;
    if (data.type === TELLS) {
      onTell(data.text);
      return;
    }
    onMessage(data);
  };
  channel.postMessage({ type: WANTS_HELLO });

  return {
    /**
     * Ask the editor to do something this window cannot.
     *
     * Running a program needs the blocks, and the blocks are in the editor.
     * So this window asks rather than pretending to be able to.
     */
    ask(action) {
      channel.postMessage({ type: ASKS, action });
    },
    close() { channel.close(); },
  };
}
