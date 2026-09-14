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

  /**
   * Hold the voice by holding a lock on it.
   *
   * The claim used to be a message and nothing more: a window said "I am
   * speaking now" and every other window was trusted to hear it and go quiet.
   * That works until a message is missed or a window never learns it has been
   * taken over — and then two windows are both certain they hold the voice
   * and both talk, which is the failure it exists to prevent. A message that
   * has to arrive for the page to behave is a poor thing to hang this on.
   *
   * A Web Lock is the same idea with the browser keeping the count. Exactly
   * one window can hold a named lock; `steal` hands it over and *rejects the
   * previous holder's request*, so losing it is something a window is told
   * rather than something it has to infer. A window that closes releases it
   * without having to say so, which the message never did: closing the robot
   * view used to leave the editor waiting for a window that was gone.
   *
   * The message is still sent, for browsers without locks and because it
   * costs nothing.
   */
  const locks = host?.navigator?.locks ?? globalThis.navigator?.locks;
  let release = null;
  let request = 0;

  const holdTheLock = () => {
    if (!locks) return;

    // Already holding it. Asking again would steal it from ourselves, and a
    // steal rejects the previous request -- our own -- which reads exactly
    // like another window taking the voice. The robot view claims once on
    // arrival and once more when it is opened deliberately, so it did that
    // to itself and went mute.
    if (release) return;

    // And if a later request does supersede this one, its rejection is not
    // news either. Only the newest request speaks for this window.
    const mine = ++request;
    locks.request(CHANNEL, { steal: true }, () => {
      if (mine !== request) return Promise.resolve();
      holding = true;
      onTaken?.();
      // Held until somebody steals it; that is what releases this.
      return new Promise((resolve) => { release = resolve; });
    }).catch(() => {
      if (mine !== request) return;
      release = null;
      // Stolen. The only way out of that promise is another window taking it.
      if (!holding) return;
      holding = false;
      onLost?.();
    });
  };

  const claim = () => {
    if (holding) return;

    // With a lock, holding it is the only thing that makes this window the
    // one that speaks. Saying so before the browser has agreed is how two
    // windows both end up speaking: each declares itself, optimistically, and
    // for as long as it takes the steal to land they are both certain. The
    // grant calls onTaken; nothing else does.
    if (locks) {
      channel.postMessage({ id });
      holdTheLock();
      return;
    }

    holding = true;
    onTaken?.();
    channel.postMessage({ id });
  };

  // Claim on arrival, and again whenever this window is the one being looked
  // at. A window opened second takes the voice, which is what somebody who
  // just opened it expects.
  channel.postMessage({ id });

  // The lock is asked for straight away, but a grant is a turn of the event
  // loop away and a window says its first words before that — the robot view
  // announces itself as it opens. Starting quiet swallowed those: the window
  // was still waiting to be told it could speak. So it starts holding, as it
  // always did, and the lock corrects it the moment another window takes it.
  //
  // The race that leaves is a few milliseconds at a window's birth. The one
  // that mattered was claim() declaring itself the speaker on every focus,
  // which is as long as a person takes to look away and back.
  holdTheLock();

  host?.addEventListener?.('focus', claim);

  return {
    claim() {
      // Forced, for a window that has just been opened and has not been
      // focused yet — opening it is the claim. With a lock there is nothing
      // to force: the request is already in flight and the grant decides.
      if (!locks) holding = false;
      claim();
    },

    /** Whether the browser agrees this window holds the voice. */
    hasTheLock: () => Boolean(release),

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
      release?.();
      release = null;
      channel.close();
    },
  };
}
