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
const CHANNELS = {
  voice: 'Speaking with the browser voice.',
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
export function mountCommentaryControls(elements, { speaker, commentary }) {
  const {
    toggle, volume, volumeValue, describe, transcript, channel, testVoice, voice,
  } = elements;

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

  function showChannel() {
    if (!channel) return;
    const reason = speaker.channelReason;
    channel.textContent = [CHANNELS[speaker.channel] ?? '', reason].filter(Boolean).join(' ');
    // Only the working case is unremarkable; the rest are the answer to
    // "why can I not hear anything".
    channel.classList.toggle('is-fallback', speaker.channel !== 'voice');
  }
  speaker.onChannelChange = showChannel;
  showChannel();

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

  if (volume) {
    volume.value = String(Math.round(speaker.volume * 100));
    showVolume();
    volume.addEventListener('input', () => {
      speaker.setVolume(Number(volume.value) / 100);
      showVolume();
    });
    // Speak a sample on release rather than on every step of the slider:
    // dragging would otherwise cancel and restart a sentence per pixel.
    volume.addEventListener('change', () => {
      speaker.announce(speaker.volume > 0 ? 'Commentary at this volume.' : 'Commentary muted.');
    });
  }

  function showVolume() {
    if (!volumeValue) return;
    const percent = Math.round(speaker.volume * 100);
    // "0%" reads as broken. Say what actually happens at zero: the commentary
    // is not gone, it has moved to the screen reader.
    volumeValue.textContent = percent === 0 ? 'muted — screen reader only' : `${percent}%`;
  }

  describe?.addEventListener('click', () => commentary.describeNow());

  // Speaking straight out of a click is the one way to tell "this browser
  // cannot" apart from "this browser has not been allowed to yet" — Chrome
  // refuses until the page has been used, and refuses silently.
  testVoice?.addEventListener('click', () => speaker.test());

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
