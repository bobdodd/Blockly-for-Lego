/**
 * Saying the scene out loud.
 *
 * The pattern is the one the audio maps on a11ybob.com use, and it is here for
 * the same reason: **a polite live region queues.** The robot moves twenty
 * times a second. Push commentary into a live region and the screen reader is
 * still reading where the robot was four events ago, which is worse than
 * silence — a student steers by it and steers wrong.
 *
 * `speechSynthesis` can be *cancelled*. So every announcement replaces the one
 * before it: latest wins, and what you hear is where the robot is now.
 *
 * The channel picks itself:
 *
 *   speech engine present, audio on, volume above zero -> speechSynthesis
 *   audio off, volume at zero, or no engine at all     -> polite live region
 *
 * That last fallback is not a nicety. De-Googled Android phones ship a speech
 * engine with no voices installed, which reports as present and then says
 * nothing, so the engine is probed for actual voices rather than trusted.
 *
 * Everything spoken is also mirrored to a visible transcript. Deaf and
 * hard-of-hearing students get the commentary, and so does anyone working in a
 * noisy club room — this is a room full of robots.
 *
 * What this adds to the maps' version: a **volume control**. The commentary
 * competes with the program's own narration, with a classmate talking, and
 * with the next bench over. Volume at zero deliberately hands the commentary
 * back to the live region rather than going silent, so a student who turns it
 * down is quieting the speech, not switching off their only source of
 * information.
 */

const AUDIO_KEY = 'blockly-for-lego.commentary-audio';
const VOLUME_KEY = 'blockly-for-lego.commentary-volume';
const VOICE_KEY = 'blockly-for-lego.commentary-voice';
const RATE_KEY = 'blockly-for-lego.commentary-rate';

/**
 * How fast the commentary is read.
 *
 * The range is deliberately wide at the top. A screen reader user who has
 * spent years at three or four times normal speed does not slow down for one
 * web page, and a narration they have to wait through is one they will turn
 * off — which for the 3D view means turning off the only access to it there
 * is. The bottom end matters just as much for somebody meeting a robot, or a
 * synthetic voice, for the first time.
 */
const SLOWEST = 0.5;
const FASTEST = 5;

/**
 * Voices to reach for before working one out.
 *
 * Named rather than derived because "a local voice in the right language" is
 * a rule that picks whatever the operating system happens to list first, and
 * that turned out to be something Chrome would claim to speak in and produce
 * nothing with. Daniel is a local en-GB voice present on macOS, clear at the
 * speed this narration runs at, and — the part that matters in a club room —
 * the *same* voice in every browser that has it, so a student who moves
 * between machines is not relearning a voice each time.
 *
 * Absent ones are skipped, so this costs nothing on a system without them.
 */
const PREFERRED_VOICES = ['Daniel', 'Serena', 'Karen', 'Google UK English Male'];

/** How long to wait before deciding an engine that never started is dead. */
const ENGINE_DEAD_MS = 6000;

/**
 * How long to give the engine to actually start making a sound.
 *
 * Chrome reports no voices until it feels like it, and a de-Googled Android
 * has an engine with no voices at all. Up front those look identical; the
 * moment you try to speak they do not. So this waits to be told rather than
 * guessing, and only then falls back.
 */
const SPEECH_START_MS = 2500;

/**
 * How many starts have to fail before the engine is written off.
 *
 * One is not enough. Chrome's very first utterance can take over a second to
 * begin — loading voices, sometimes fetching a network one — and treating
 * that single slow start as a broken engine is what left it mute for the rest
 * of the session.
 */
const FAILURES_BEFORE_FALLBACK = 2;

/**
 * Errors that mean "we stopped it", not "it is broken".
 *
 * Every announcement cancels the one before it, and a cancel fires `error`
 * with one of these. Counting them as failures would write the engine off
 * during perfectly normal use.
 */
const OUR_DOING = new Set(['canceled', 'cancelled', 'interrupted']);

/**
 * How often to nudge a long utterance along.
 *
 * Chrome stops speaking after about fifteen seconds and reports no error. The
 * description of the mat runs well past that, so without this it would trail
 * off mid-sentence.
 */
const KEEPALIVE_MS = 10000;

export class Speaker {
  /**
   * @param {object} options
   * @param {string} options.regionId  id of the polite live region to fall back to
   * @param {(text: string) => void} [options.caption]  visible transcript mirror
   * @param {Storage} [options.storage]  injectable for tests
   * @param {object} [options.window]    injectable for tests
   */
  constructor({ regionId, caption = null, storage, window: win } = {}) {
    this.window = win ?? (typeof window !== 'undefined' ? window : null);
    this.storage = storage ?? safeStorage(this.window);
    this.regionId = regionId;
    this.caption = caption;

    this.synth = this.window && 'speechSynthesis' in this.window
      ? this.window.speechSynthesis
      : null;

    /**
     * Set only once an attempt to speak has demonstrably produced nothing.
     *
     * Never assumed up front. Judging the engine by whether `getVoices()` has
     * filled in yet is how Chrome came to be silent while Safari was fine:
     * Safari populates that list synchronously and Chrome does not, so the
     * same code read one as working and the other as broken before either had
     * been asked to say a word.
     */
    /**
     * True while another window is doing the speaking.
     *
     * Both windows receive the same telemetry and both used to say it, a
     * moment apart, which sounds like the program running twice. The visible
     * transcript is still written — two people reading two screens is not a
     * duplication of anything — but nothing is spoken and nothing goes to the
     * live region, because the other window is already saying it.
     */
    this.yielded = false;
    this.speechBroken = false;
    /** What the browser last said went wrong, verbatim. */
    this.lastError = null;
    this._failures = 0;
    this.onChannelChange = null;
    this._primed = false;
    this._regionTimer = null;
    this._keepAlive = null;
    /** Rising count, so a superseded utterance never speaks late. */
    this._token = 0;

    // Voices arriving is good news — an engine that once looked broken may
    // not be — so it clears the flag. It is never used to set it.
    this.synth?.addEventListener?.('voiceschanged', () => {
      if (!this.speechBroken) return;
      /**
     * True while another window is doing the speaking.
     *
     * Both windows receive the same telemetry and both used to say it, a
     * moment apart, which sounds like the program running twice. The visible
     * transcript is still written — two people reading two screens is not a
     * duplication of anything — but nothing is spoken and nothing goes to the
     * live region, because the other window is already saying it.
     */
    this.yielded = false;
    this.speechBroken = false;
      this.onChannelChange?.(this.channel);
    });

    // Default on: speech is the primary channel here, and a student who wants
    // the live region instead can say so once and have it remembered.
    this.audioOn = this.storage.getItem(AUDIO_KEY) !== 'off';
    this.volume = clampVolume(Number(this.storage.getItem(VOLUME_KEY) ?? 1));
    this.voiceName = this.storage.getItem(VOICE_KEY) || '';
    this.rate = clampRate(Number(this.storage.getItem(RATE_KEY) ?? 1));

    // iOS unlocks the speech engine only inside a user gesture, and the first
    // gesture here is usually pressing Run — by which time the robot is
    // already moving. Prime on whatever gesture comes first.
    const prime = () => this.prime();
    this.window?.document?.addEventListener?.('pointerdown', prime, { once: true, capture: true });
    this.window?.document?.addEventListener?.('keydown', prime, { once: true, capture: true });
  }

  /** Wake the engine with a silent utterance, inside a user gesture. */
  prime() {
    if (this._primed || !this.synth) return;
    this._primed = true;
    try {
      const utterance = new this.window.SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      this.synth.speak(utterance);
      // Speaking inside the gesture is what unlocks iOS; leaving the thing
      // queued afterwards is not part of the deal. A whitespace utterance is
      // one of the shapes Chrome is known to mishandle, and left sitting in
      // the queue it makes every later announcement take the cancel path for
      // no reason.
      this.synth.cancel();
    } catch {
      // The engine refused. The live-region path still works, which is the
      // whole reason it exists.
    }
  }

  /** True while the engine is actually mid-sentence. */
  get speaking() {
    return Boolean(this.synth?.speaking);
  }

  /** True when speech is the channel an announcement would take right now. */
  get willSpeak() {
    return Boolean(
      !this.yielded && this.audioOn && this.volume > 0 && this.synth && !this.speechBroken,
    );
  }

  /** Hand the voice to another window, or take it back. */
  setYielded(yielded) {
    const was = this.yielded;
    this.yielded = Boolean(yielded);
    if (this.yielded && !was) this.stop();
    if (this.yielded !== was) this.onChannelChange?.(this.channel);
  }

  /**
   * Which channel is carrying the words, for showing on the page.
   *
   * Worth showing. "It is silent" and "it is going to your screen reader" are
   * the same experience for anyone not running one, and without this the
   * difference is invisible from the outside — which is how a browser-specific
   * fault stayed hidden.
   */
  get channel() {
    if (this.yielded) return 'elsewhere';
    if (!this.audioOn) return 'off';
    if (this.volume === 0) return 'muted';
    if (!this.synth) return 'no-engine';
    return this.speechBroken ? 'no-voice' : 'voice';
  }

  /**
   * What the browser said, when it said anything.
   *
   * `not-allowed` in particular is not a fault to be worked around: it means
   * the page has not been interacted with yet, and the fix is a button press.
   */
  get channelReason() {
    if (this.channel !== 'no-voice') return '';
    if (this.lastError === 'not-allowed') {
      return 'The browser will not speak until you have used the page. '
        + 'Press "Test the voice".';
    }
    if (this.lastError) return `The browser reported "${this.lastError}".`;
    if (this.synth?.paused) {
      return 'The browser has speech paused. Press "Test the voice" to wake it.';
    }
    return 'It accepted the speech and never started, without saying why. '
      + 'There is a report in the browser console.';
  }

  setAudio(on) {
    this.audioOn = Boolean(on);
    this.storage.setItem(AUDIO_KEY, this.audioOn ? 'on' : 'off');
    this.onChannelChange?.(this.channel);
    // Never leave half a sentence playing after the switch: the student turned
    // it off because they wanted quiet now, not quiet after this sentence.
    if (!this.audioOn) this.stop();
  }

  /** Every voice the browser offers, local ones first. */
  voices() {
    let all = [];
    try {
      all = this.synth?.getVoices() ?? [];
    } catch {
      return [];
    }
    return [...all].sort((a, b) => {
      if (Boolean(a.localService) !== Boolean(b.localService)) return a.localService ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  /**
   * Which voice to use.
   *
   * Chrome will happily report that it is speaking while producing no sound
   * at all, and the usual reason is the voice it picks when nobody picks one:
   * with two hundred of them listed, including network voices that need a
   * fetch to work, the default is not reliably one that can be heard. Naming
   * a **local** voice in the page's own language removes the guesswork.
   */
  pickVoice() {
    const voices = this.voices();
    if (voices.length === 0) return null;

    if (this.voiceName) {
      const chosen = voices.find((voice) => voice.name === this.voiceName);
      if (chosen) return chosen;
    }

    const language = (this.window?.document?.documentElement?.lang || 'en')
      .toLowerCase().slice(0, 2);
    const speaks = (voice) => String(voice.lang ?? '').toLowerCase().startsWith(language);

    // A named favourite still has to speak the page's language. Reading
    // English sentences in a French voice is not an improvement on picking
    // badly, and a mat description is the wrong place to find that out.
    for (const name of PREFERRED_VOICES) {
      const preferred = voices.find((voice) => voice.name === name && speaks(voice));
      if (preferred) return preferred;
    }

    const local = voices.filter((voice) => voice.localService);

    return local.find(speaks)
      ?? local.find((voice) => voice.default)
      ?? local[0]
      ?? voices.find(speaks)
      ?? voices[0]
      ?? null;
  }

  /** Use a particular voice from now on. An empty name goes back to choosing. */
  setVoice(name) {
    this.voiceName = name || '';
    this.storage.setItem(VOICE_KEY, this.voiceName);
    /**
     * True while another window is doing the speaking.
     *
     * Both windows receive the same telemetry and both used to say it, a
     * moment apart, which sounds like the program running twice. The visible
     * transcript is still written — two people reading two screens is not a
     * duplication of anything — but nothing is spoken and nothing goes to the
     * live region, because the other window is already saying it.
     */
    this.yielded = false;
    this.speechBroken = false;
    this._failures = 0;
    this.onChannelChange?.(this.channel);
  }

  /** How fast to read, as a multiple of the voice's normal speed. */
  setRate(value) {
    const wasSpeaking = this.willSpeak;
    this.rate = clampRate(value);
    this.storage.setItem(RATE_KEY, String(this.rate));
    // Rate belongs to an utterance, not to the engine, so a change only takes
    // effect on the next one. Cutting the current one short is better than
    // letting it run on at a speed the student has just rejected.
    if (wasSpeaking && this.synth) this.stop();
  }

  /** The range a rate control should offer. */
  static get rateRange() {
    return { min: SLOWEST, max: FASTEST };
  }

  setVolume(value) {
    const wasSpeaking = this.willSpeak;
    this.volume = clampVolume(value);
    this.storage.setItem(VOLUME_KEY, String(this.volume));
    this.onChannelChange?.(this.channel);
    // A change only takes effect on the next utterance — `volume` is a
    // property of an utterance, not of the engine — so cut the current one
    // short rather than letting it play on at the old level.
    if (wasSpeaking && this.synth) this.stop();
  }

  /**
   * Say something. The latest announcement always wins.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {boolean} [options.caption=true]  mirror to the visible transcript
   * @param {() => void} [options.onDone]     fires when it has finished, or
   *   when it was interrupted by a newer one, or when the engine turned out
   *   not to work. It must always fire eventually: callers wait on it.
   */
  announce(text, { caption = true, onDone } = {}) {
    if (!text) {
      onDone?.();
      return;
    }
    if (caption) this.caption?.(text);

    // Another window is saying this. The transcript above is still written,
    // because that is per-screen and not a duplication; the sound is not.
    if (this.yielded) {
      onDone?.();
      return;
    }

    let settled = false;
    const finish = onDone
      ? () => {
        if (settled) return;
        settled = true;
        onDone();
      }
      : null;

    if (this.willSpeak) {
      this._speak(text, finish);
      return;
    }

    this._toRegion(text);
    this._finishAfterReading(text, finish);
  }

  /**
   * Speak, and notice if nothing comes out.
   *
   * Two things here are working around Chrome specifically, and neither shows
   * up in Safari:
   *
   *  - **`speak()` in the same tick as `cancel()` is silently dropped.** So a
   *    cancel hands over to the next macrotask before speaking. Every
   *    announcement still replaces the one before it; it just does it a tick
   *    later.
   *  - **Nothing may happen at all**, with no error, when the engine has not
   *    finished waking up. `onstart` is the only honest signal, so a short
   *    watchdog waits for it and falls back to the live region if it never
   *    comes.
   */
  _speak(text, finish) {
    const token = ++this._token;

    const start = () => {
      // A newer announcement arrived while this one was waiting its tick.
      if (token !== this._token) return;

      const utterance = new this.window.SpeechSynthesisUtterance(text);
      utterance.volume = this.volume;
      utterance.rate = this.rate;

      // Naming the voice rather than leaving it to the browser. See pickVoice.
      const voice = this.pickVoice();
      if (voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
      }

      let settled = false;
      let stopWatching = null;
      const giveUp = (reason) => {
        stopWatching?.();
        if (settled || token !== this._token) return;
        settled = true;
        this.lastError = reason;
        this._failures += 1;
        // One slow start is not a broken engine; a run of them is.
        if (this._failures >= FAILURES_BEFORE_FALLBACK) this.speechBroken = true;
        this.onChannelChange?.(this.channel);
        this._toRegion(text);
        // Not straight away, even though this one failed. The words have gone
        // to the live region and a screen reader is about to read them, so
        // "done" is when that has had time to happen -- the same estimate the
        // planned fallback uses. Finishing immediately let whatever was
        // waiting on this start on top of it: a dead engine made "Connected."
        // resolve in a millisecond, and the description of the mat replaced
        // it in the region before it had been read at all.
        this._finishAfterReading(text, finish);
      };

      utterance.onstart = () => {
        settled = true;
        this._failures = 0;
        this.lastError = null;
        this._startKeepAlive();
        this.onChannelChange?.(this.channel);
      };

      // Always wired, not only when a caller wants to know when it finished.
      // Leaving this off for the announcements nobody waits on threw away the
      // browser's own explanation of why it would not speak — which is the
      // one fact that would have identified this in a minute.
      utterance.onerror = (event) => {
        const reason = event?.error ?? 'unknown';
        if (OUR_DOING.has(reason)) return; // we cancelled it ourselves
        giveUp(reason);
      };

      // Watching for the end must not take the error with it. This used to
      // set its own `utterance.onerror`, which overwrote the one above --
      // so any announcement a caller was waiting on lost its fallback
      // altogether: the engine refused, nothing reached the live region, and
      // the caller was told it had finished a millisecond later. On a machine
      // with no voices that meant "Connected." was never said at all, by any
      // route, and the description of the mat began in its place.
      stopWatching = finish ? this._watchForEnd(utterance, finish) : null;

      // A paused engine accepts an utterance, queues it, and never starts it:
      // no sound, no `start`, no `error`. Nothing in this code pauses it, but
      // Chrome and anything else sharing the engine can, and once it happens
      // every later announcement disappears in the same silent way. Resuming
      // costs nothing when it is already running.
      try {
        this.synth.resume();
      } catch {
        // Some engines throw on resume when nothing is paused.
      }
      this.synth.speak(utterance);

      this.window.setTimeout(() => {
        if (settled || token !== this._token) return;
        if (this.synth.speaking || this.synth.pending) return;
        giveUp(null);
      }, SPEECH_START_MS);
    };

    if (this.synth.speaking || this.synth.pending) {
      this.synth.cancel();
      this.window.setTimeout(start, 0);
    } else {
      start();
    }
  }

  /**
   * Try the engine again from inside a real click.
   *
   * Chrome will not speak until the page has been interacted with, and when
   * it refuses it does so silently. Speaking straight out of a button press
   * is the one way to tell "this browser cannot" apart from "this browser has
   * not been allowed to yet", and it is a test a student can run themselves
   * rather than one that needs someone reading the console.
   */
  test() {
    /**
     * True while another window is doing the speaking.
     *
     * Both windows receive the same telemetry and both used to say it, a
     * moment apart, which sounds like the program running twice. The visible
     * transcript is still written — two people reading two screens is not a
     * duplication of anything — but nothing is spoken and nothing goes to the
     * live region, because the other window is already saying it.
     */
    this.yielded = false;
    this.speechBroken = false;
    this.lastError = null;
    this._failures = 0;
    this.onChannelChange?.(this.channel);

    this.prime();
    // Priming cancels the utterance it just queued, and Chrome drops a
    // `speak()` issued in the same tick as a `cancel()` — so testing the voice
    // was itself guaranteed to be silent on the one browser it existed to
    // diagnose.
    this.window.setTimeout(() => {
      this.announce('The browser voice is working.');
      // And again once it has had a moment: what the engine *did* with the
      // utterance is the interesting half, and it is not knowable yet.
      this.window.setTimeout(() => this.diagnose('after'), SPEECH_START_MS);
    }, 0);
    return this.diagnose('before');
  }

  /**
   * Everything worth knowing about the engine, in one object.
   *
   * For pasting into a bug report. Guessing at a browser from a description of
   * silence has cost several rounds of this already; these are the facts that
   * would have settled it.
   */
  diagnose(when = 'now') {
    let voices = -1;
    try {
      voices = this.synth?.getVoices().length ?? -1;
    } catch {
      voices = -1;
    }

    const report = {
      engine: Boolean(this.synth),
      voices,
      speaking: this.synth?.speaking ?? null,
      pending: this.synth?.pending ?? null,
      paused: this.synth?.paused ?? null,
      audioOn: this.audioOn,
      volume: this.volume,
      rate: this.rate,
      voice: this.pickVoice()?.name ?? null,
      voiceIsLocal: this.pickVoice()?.localService ?? null,
      chosenByHand: this.voiceName || null,
      channel: this.channel,
      lastError: this.lastError,
      failures: this._failures,
    };
    this.window?.console?.log?.(`Blockly for Lego — speech (${when}):`, report);
    return report;
  }

  /**
   * Keep a long utterance going.
   *
   * Chrome stops after about fifteen seconds, silently. The description of
   * the mat runs longer than that, so it would trail off mid-sentence with
   * nothing to show for it. `resume()` on speech that is already playing is a
   * no-op everywhere else.
   */
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAlive = this.window.setInterval(() => {
      if (!this.synth?.speaking) {
        this._stopKeepAlive();
        return;
      }
      try {
        this.synth.resume();
      } catch {
        // Some engines throw on resume when nothing is paused.
      }
    }, KEEPALIVE_MS);
  }

  _stopKeepAlive() {
    if (this._keepAlive === null) return;
    this.window.clearInterval(this._keepAlive);
    this._keepAlive = null;
  }

  /**
   * Detect the end of an utterance.
   *
   * `onend` is unreliable across engines — it can fire late, early, or not at
   * all after a cancel — so the engine's own `speaking` flag is polled: it
   * must have been *seen* speaking, and then have stopped. Being interrupted
   * by a newer announcement satisfies that too, which is correct; that turn is
   * over either way.
   */
  _watchForEnd(utterance, finish) {
    let sawSpeaking = false;
    let waited = 0;

    const poll = this.window.setInterval(() => {
      waited += 250;
      if (this.synth.speaking) sawSpeaking = true;

      const finished = sawSpeaking && !this.synth.speaking;
      const neverStarted = !sawSpeaking && waited >= ENGINE_DEAD_MS;
      const runaway = waited >= 180000; // a rare engine bug: stuck speaking

      if (finished || neverStarted || runaway) {
        this.window.clearInterval(poll);
        finish();
      }
    }, 250);

    utterance.onend = () => {
      if (sawSpeaking) {
        this.window.clearInterval(poll);
        finish();
      }
    };

    // No `onerror` here: it belongs to _speak, which needs the reason so it
    // can fall back to the live region. This hands back a way to stop
    // watching instead, for _speak to call once it has dealt with the error.
    return () => this.window.clearInterval(poll);
  }

  /**
   * Call back once the live region has had time to be read.
   *
   * A screen reader gives no end signal at all -- it tells a page nothing
   * about what it is saying or when it stops -- so this is an estimate and
   * nothing more. It is the honest best available, and it is only ever used
   * on the region path; when the engine speaks, the utterance says when it
   * ended and that is what gets waited on.
   */
  _finishAfterReading(text, finish) {
    if (!finish) return;
    this.window?.setTimeout(finish, Math.min(12000, 900 + String(text ?? '').length * 55));
  }

  /** Write to the polite live region, latest-wins. */
  _toRegion(text) {
    const region = this.window?.document?.getElementById(this.regionId);
    if (!region) return;

    // Clear, then set on a timer. Two reasons: setting the same text twice in
    // a row is a no-op to a screen reader, so an unchanged message would never
    // be re-announced; and a pending write is replaced rather than queued, so
    // the region holds the latest text instead of a backlog.
    if (this._regionTimer) this.window.clearTimeout(this._regionTimer);
    region.textContent = '';
    this._regionTimer = this.window.setTimeout(() => {
      this._regionTimer = null;
      region.textContent = text;
    }, 60);
  }

  /** Stop immediately. */
  stop() {
    this._token += 1;
    this._stopKeepAlive();
    try {
      this.synth?.cancel();
    } catch {
      // Some engines throw on cancel when nothing is speaking.
    }
  }
}

function clampVolume(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function clampRate(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(FASTEST, Math.max(SLOWEST, value));
}

/**
 * localStorage, or something that looks enough like it.
 *
 * Private browsing and locked-down school machines both throw on access rather
 * than returning null, and a student losing the commentary because their
 * preference could not be saved would be an absurd failure.
 */
function safeStorage(win) {
  try {
    const storage = win?.localStorage;
    storage?.getItem(AUDIO_KEY);
    if (storage) return storage;
  } catch {
    // fall through
  }
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
}
