/**
 * The commentary's controls, wired to the speaker.
 *
 * Kept out of both entry points because the editor and the standalone viewer
 * mount the same controls over the same objects, and two copies of this would
 * drift apart — which for a control that decides whether a student hears
 * anything is not a cosmetic kind of drift.
 *
 * The markup lives in the pages, not here. A control built by script is a
 * control that does not exist until the script has run and the view has
 * loaded, and these are the controls someone reaches for *because* they cannot
 * see whether anything is happening.
 */

/** How many lines of transcript to keep. */
const MAX_TRANSCRIPT = 100;

/**
 * What is actually carrying the words.
 *
 * Worth saying on the page. To anyone not running a screen reader, "silent"
 * and "going to your screen reader" are the same experience — which is how a
 * browser-specific fault (Chrome mute, Safari fine) stayed invisible from the
 * outside for as long as it did.
 */
/** How long the troubleshooting message survives the engine's own updates. */
const TROUBLESHOOT_MS = 30000;

/**
 * The one cause the page cannot detect.
 *
 * A browser told not to play sound for a site silences speech while still
 * reporting `speaking: true`, with no error and a healthy voice list. Nothing
 * in the engine's state distinguishes it from working, so this is asked
 * rather than deduced. It is the first thing to check, because it is the
 * cause that looks exactly like every other one.
 */
const HEARD_NOTHING = 'That should have been spoken aloud. If you heard nothing, '
  + 'the browser is blocking sound for this site: open the padlock in the address '
  + 'bar, then Site settings, and allow Sound and Autoplay. Chrome silences speech '
  + 'that way without reporting any error.';

const CHANNELS = {
  voice: 'Speaking with the browser voice.',
  elsewhere: 'Another window is speaking. Click here to move the voice to this one.',
  'no-voice': 'The commentary is going to your screen reader, because the '
    + 'browser voice did not play.',
  'no-engine': 'This browser has no speech of its own, so the commentary is '
    + 'going to your screen reader.',
  off: 'Speech is off. The commentary is going to your screen reader.',
  muted: 'The volume is at zero, so the commentary is going to your screen reader.',
};

/**
 * @param {object} elements  the controls, already in the page
 * @param {HTMLInputElement} elements.toggle  speak / do not speak
 * @param {HTMLInputElement} elements.volume  range, 0–100
 * @param {HTMLElement} [elements.volumeValue]  visible read-out
 * @param {HTMLButtonElement} [elements.describe]  "describe the scene now"
 * @param {HTMLElement} [elements.transcript]  the visible mirror
 * @param {{speaker: object, commentary: object}} parts
 */
export function mountCommentaryControls(elements, parts) {
  const { speaker, commentary } = parts;
  const {
    toggle, volume, volumeValue, rate, rateValue,
    describe, transcript, channel, testVoice, voice,
  } = elements;

  /**
   * What a slider should say about itself.
   *
   * A range reports its raw number to a screen reader, and "2.5" on its own
   * is not a speed. `aria-valuetext` replaces it with something that is, and
   * has to be rewritten on every change or it becomes a lie the moment the
   * slider moves.
   */
  function setValueText(control, output, text) {
    if (control) control.setAttribute('aria-valuetext', text);
    if (output) output.textContent = text;
  }

  /** "normal", "twice normal speed", "half normal speed". */
  function sayRate(value) {
    if (value === 1) return 'normal speed';
    if (value === 2) return 'twice normal speed';
    if (value === 0.5) return 'half normal speed';
    return `${value} times normal speed`;
  }

  /**
   * Offer the browser's voices, local ones first.
   *
   * Not a luxury. Chrome will report that it is speaking while producing no
   * sound, and which voice was picked is the usual reason — so being able to
   * pick a different one is the remedy a student can apply themselves. It is
   * also just useful: a voice you can follow for an hour is not the same as
   * one you can tolerate for a sentence.
   */
  function fillVoices() {
    if (!voice) return;
    const available = speaker.voices();
    const chosen = voice.value || speaker.voiceName;
    const doc = voice.ownerDocument;

    voice.replaceChildren();
    const auto = doc.createElement('option');
    auto.value = '';
    auto.textContent = available.length ? `Chosen for you (${speaker.pickVoice()?.name ?? '—'})` : 'Chosen for you';
    voice.append(auto);

    for (const option of available) {
      const item = doc.createElement('option');
      item.value = option.name;
      item.textContent = option.localService ? option.name : `${option.name} (needs the internet)`;
      voice.append(item);
    }
    voice.value = available.some((v) => v.name === chosen) ? chosen : '';
  }

  if (voice) {
    fillVoices();
    // Chrome fills its voice list after the page has loaded, so the first
    // attempt is often empty and has to be redone.
    speaker.synth?.addEventListener?.('voiceschanged', fillVoices);
    voice.addEventListener('change', () => {
      speaker.setVoice(voice.value);
      speaker.announce(voice.value ? 'This is the voice you chose.' : 'Back to the usual voice.');
    });
  }

  /**
   * While someone is troubleshooting, the remedy stays put.
   *
   * Otherwise the engine reporting that it has started speaking immediately
   * overwrites the very message explaining what to do when you cannot hear
   * it speaking.
   */
  let troubleshootingUntil = 0;

  function showChannel() {
    if (!channel) return;
    if (Date.now() < troubleshootingUntil) return;
    const reason = speaker.channelReason;
    channel.textContent = [CHANNELS[speaker.channel] ?? '', reason].filter(Boolean).join(' ');
    // Only the working case is unremarkable; the rest are the answer to
    // "why can I not hear anything".
    channel.classList.toggle('is-fallback', speaker.channel !== 'voice');
    // Only actionable when there is something to do about it. The attribute
    // is removed rather than set to -1: a line of explanatory text is not a
    // focus target waiting to be scripted, and tabindex="-1" on it is a
    // promise to move focus there that nothing in this page keeps.
    const claimable = speaker.channel === 'elsewhere';
    if (claimable) {
      channel.tabIndex = 0;
      channel.role = 'button';
    } else {
      channel.removeAttribute('tabindex');
      channel.role = null;
    }
  }
  speaker.onChannelChange = showChannel;
  showChannel();

  // The line says "click here to move the voice to this one", so it has to be
  // something you can click — and, more to the point, reach with a keyboard.
  if (channel) {
    channel.addEventListener('click', () => parts.takeTheVoice?.());
    channel.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      parts.takeTheVoice?.();
    });
  }

  // The stored preference wins over the markup's default. Otherwise a student
  // who turned speech off last week opens the page, sees a ticked box, and is
  // told by the page that something is on when it is not.
  if (toggle) {
    toggle.checked = speaker.audioOn;
    toggle.addEventListener('change', () => {
      speaker.setAudio(toggle.checked);
      // Confirm the change through the channel it just switched to, so the
      // answer to "did that work?" is the thing itself rather than a promise.
      speaker.announce(
        toggle.checked ? 'Commentary will be spoken.' : 'Commentary will go to your screen reader.',
      );
    });
  }

  if (rate) {
    const { min, max } = speaker.constructor.rateRange;
    rate.min = String(min);
    rate.max = String(max);
    rate.value = String(speaker.rate);
    showRate();

    rate.addEventListener('input', () => {
      speaker.setRate(Number(rate.value));
      showRate();
    });
    // Nothing is spoken here, deliberately.
    //
    // Moving the slider is already an announcement: focus is on the control
    // that changed, so the screen reader reads the new `aria-valuetext` the
    // moment it is written. Speaking a sample on top of that put the browser
    // voice and the screen reader in the same ear at the same time — two
    // voices over each other, which demonstrates nothing about either.
    //
    // The sample was here because a speed is a thing you judge by ear, and
    // that is still true: "Test the voice" is the way to hear it, and it
    // speaks at whatever the sliders are set to now.
  }

  function showRate() {
    setValueText(rate, rateValue, sayRate(speaker.rate));
  }

  if (volume) {
    volume.value = String(Math.round(speaker.volume * 100));
    showVolume();
    volume.addEventListener('input', () => {
      speaker.setVolume(Number(volume.value) / 100);
      showVolume();
    });
    // Silent on release, for the reason the speed slider is: the screen
    // reader is already reading this slider's value, and the browser voice
    // talking across it is the second stream. "Test the voice" plays a
    // sample at the volume set here.
  }

  function showVolume() {
    const percent = Math.round(speaker.volume * 100);
    // "0%" reads as broken. Say what actually happens at zero: the commentary
    // is not gone, it has moved to the screen reader.
    setValueText(
      volume,
      volumeValue,
      percent === 0 ? 'muted — screen reader only' : `${percent}%`,
    );
  }

  describe?.addEventListener('click', () => commentary.describeNow());

  // Speaking straight out of a click is the one way to tell "this browser
  // cannot" apart from "this browser has not been allowed to yet".
  //
  // And then it asks, because the remaining cause is one the page cannot see.
  // A browser told not to play sound for a site silences speech while still
  // reporting that it is speaking: nothing in the engine's state gives it
  // away, so the only way to find out is to ask the person who can hear.
  testVoice?.addEventListener('click', () => {
    speaker.test();
    if (!channel) return;
    troubleshootingUntil = Date.now() + TROUBLESHOOT_MS;
    channel.textContent = HEARD_NOTHING;
    channel.classList.add('is-fallback');
  });

  if (transcript) {
    return (text) => {
      const entry = transcript.ownerDocument.createElement('li');
      entry.className = 'commentary-entry';
      entry.textContent = text;
      transcript.append(entry);
      while (transcript.children.length > MAX_TRANSCRIPT) {
        transcript.firstElementChild.remove();
      }
      transcript.scrollTop = transcript.scrollHeight;
    };
  }
  return () => {};
}
