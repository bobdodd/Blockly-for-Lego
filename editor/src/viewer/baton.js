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
 * The same channel also carries **silence**. Pressing Escape has to stop the
 * talking, and `speechSynthesis.cancel()` reaches only the document that
 * calls it — but the speakers are the room's, not the window's. A student who
 * silences the editor while the projector is mid-sentence has not silenced
 * anything they can hear. So the key is handled wherever it is pressed and
 * the request goes to every window, which is the same shape of problem as the
 * voice itself: one set of speakers, several windows.
 *
 * Its own channel rather than the telemetry one: these are questions about
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
 * @param {() => void} [options.onLost]    another window is speaking now
 * @param {() => void} [options.onTaken]   this window is speaking now
 * @param {() => void} [options.onSilence] another window asked for quiet
 * @param {object} [options.window]        injectable for tests
 * @returns {{claim: () => void, silence: () => void, holding: () => boolean,
 *            close: () => void}}
 */
export function takeTheVoice({ onLost, onTaken, onSilence, window: win } = {}) {
  const host = win ?? (typeof window !== 'undefined' ? window : null);

  // Without the channel there is no second window to clash with, as far as
  // this can tell, so the safe answer is to carry on speaking.
  if (typeof BroadcastChannel !== 'function') {
    return { claim() {}, silence() {}, holding: () => true, close() {} };
  }

  const channel = new BroadcastChannel(CHANNEL);
  const id = nextId();
  let holding = true;

  channel.onmessage = ({ data }) => {
    if (!data || data.id === id) return;

    // Silence is delivered whether or not this window holds the voice. A
    // window that yielded a moment ago can still have a sentence playing out
    // of the same speakers, and that sentence is the one being silenced.
    if (data.silence) {
      onSilence?.();
      return;
    }

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

    /**
     * Ask every other window to stop talking.
     *
     * Only the asking: the window that calls this silences itself directly,
     * because a channel does not deliver to its own sender and because a
     * round trip is the wrong way to answer a key the user just pressed.
     * Keeping the two apart is also what stops a silence from echoing back
     * and forth between windows.
     */
    silence() {
      channel.postMessage({ id, silence: true });
    },
    holding: () => holding,
    close() {
      host?.removeEventListener?.('focus', claim);
      channel.close();
    },
  };
}
