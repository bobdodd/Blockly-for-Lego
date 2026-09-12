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
 * @param {object} elements  the controls, already in the page
 * @param {HTMLInputElement} elements.toggle  speak / do not speak
 * @param {HTMLInputElement} elements.volume  range, 0–100
 * @param {HTMLElement} [elements.volumeValue]  visible read-out
 * @param {HTMLButtonElement} [elements.describe]  "describe the scene now"
 * @param {HTMLElement} [elements.transcript]  the visible mirror
 * @param {{speaker: object, commentary: object}} parts
 */
export function mountCommentaryControls(elements, { speaker, commentary }) {
  const { toggle, volume, volumeValue, describe, transcript } = elements;

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
