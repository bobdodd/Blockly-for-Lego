/**
 * One voice at a time, across windows.
 *
 * The robot view can be opened in its own window, and it describes the robot
 * out loud just as the editor does. Both windows receive the same telemetry,
 * so both spoke it: the same sentences twice over, a moment apart, which
 * sounds like the program running twice and is unusable either way.
 *
 * The rule is that the **window you are looking at** speaks. Focus is the
 * best available signal for that — it is what a person changes when they turn
 * from a laptop to a projector — and it costs nothing to observe. A window
 * that takes the voice says so; every other window hears that and goes quiet.
 *
 * Only the *audio* is exclusive. Each window keeps writing its own visible
 * transcript, because two people reading two screens is not a duplication of
 * anything.
 *
 * Its own channel rather than the telemetry one: this is a question about
 * windows, not about the robot, and mixing them would mean every viewer had
 * to filter messages meant for nobody.
 */

const CHANNEL = 'blockly-for-lego.voice';

/**
 * Enough to tell one holder from another.
 *
 * Per baton rather than per module: two windows load their own copy of this
 * file so a module-level id would work in a browser, and quietly makes every
 * baton in one process the same window — which is exactly what a test is.
 */
const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Take the voice, and be told when another window takes it.
 *
 * @param {object} options
 * @param {() => void} [options.onLost]  another window is speaking now
 * @param {() => void} [options.onTaken] this window is speaking now
 * @param {object} [options.window]      injectable for tests
 * @returns {{claim: () => void, holding: () => boolean, close: () => void}}
 */
export function takeTheVoice({ onLost, onTaken, window: win } = {}) {
  const host = win ?? (typeof window !== 'undefined' ? window : null);

  // Without the channel there is no second window to clash with, as far as
  // this can tell, so the safe answer is to carry on speaking.
  if (typeof BroadcastChannel !== 'function') {
    return { claim() {}, holding: () => true, close() {} };
  }

  const channel = new BroadcastChannel(CHANNEL);
  const id = nextId();
  let holding = true;

  channel.onmessage = ({ data }) => {
    if (data?.id === id) return;
    if (!holding) return;
    holding = false;
    onLost?.();
  };

  const claim = () => {
    if (holding) return;
    holding = true;
    onTaken?.();
    channel.postMessage({ id });
  };

  // Claim on arrival, and again whenever this window is the one being looked
  // at. A window opened second takes the voice, which is what somebody who
  // just opened it expects.
  channel.postMessage({ id });
  host?.addEventListener?.('focus', claim);

  return {
    claim() {
      // Forced, for a window that has just been opened and has not been
      // focused yet — opening it is the claim.
      holding = false;
      claim();
    },
    holding: () => holding,
    close() {
      host?.removeEventListener?.('focus', claim);
      channel.close();
    },
  };
}
