/**
 * Getting a program to and from a file.
 *
 * Two mechanisms, because they behave very differently for the people using
 * this.
 *
 * Where the **File System Access API** exists — Chrome and Edge, which this
 * editor already requires for Bluetooth — a program gets real Save and Open:
 * the student names the file in their own operating system's dialog, and
 * saving again writes back to the same file. Those dialogs are also among the
 * best-tested screen reader surfaces on any platform, which is a large part of
 * why this is preferred over building a projects list inside the page.
 *
 * Everywhere else it falls back to a download and a file input. That works,
 * but a download completes **silently** and lands wherever the browser puts
 * it, so the caller is told which mechanism ran and must say so out loud.
 *
 * Cancelling is not an error. Every function here returns `null` when the
 * person changes their mind.
 */

const FILE_TYPES = [
  {
    description: 'Blockly for Lego program',
    accept: { 'application/json': ['.json'] },
  },
];

/** True when the browser offers real Save and Open dialogs. */
export function canPickFiles() {
  return (
    typeof globalThis.showSaveFilePicker === 'function' &&
    typeof globalThis.showOpenFilePicker === 'function'
  );
}

/**
 * Ask where to save, and write.
 *
 * @returns {Promise<{handle: object|null, name: string, silent: boolean}|null>}
 *   `handle` can be written to again without asking. `silent` is true when the
 *   file was downloaded rather than named, so the caller must announce it.
 */
export async function saveAs(text, suggestedName) {
  if (!canPickFiles()) {
    download(text, suggestedName);
    return { handle: null, name: suggestedName, silent: true };
  }

  let handle;
  try {
    handle = await globalThis.showSaveFilePicker({
      suggestedName,
      types: FILE_TYPES,
    });
  } catch (error) {
    if (error?.name === 'AbortError') return null; // changed their mind
    throw error;
  }

  await write(handle, text);
  return { handle, name: handle.name, silent: false };
}

/**
 * Write to a file already chosen. Returns false if the handle is no longer
 * usable — permission can lapse between sessions — so the caller can fall
 * back to {@link saveAs}.
 */
export async function saveToHandle(handle, text) {
  if (!handle) return false;

  const permission = await handle.queryPermission?.({ mode: 'readwrite' });
  if (permission === 'denied') return false;
  if (permission === 'prompt') {
    const granted = await handle.requestPermission?.({ mode: 'readwrite' });
    if (granted !== 'granted') return false;
  }

  await write(handle, text);
  return true;
}

/**
 * Ask for a file and read it.
 *
 * @returns {Promise<{text: string, handle: object|null, name: string}|null>}
 */
export async function open() {
  if (!canPickFiles()) return openViaInput();

  let handle;
  try {
    [handle] = await globalThis.showOpenFilePicker({
      types: FILE_TYPES,
      multiple: false,
    });
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }

  const file = await handle.getFile();
  return { text: await file.text(), handle, name: file.name };
}

// --------------------------------------------------------------------------
// fallbacks
// --------------------------------------------------------------------------

async function write(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // give the browser a moment to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openViaInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    // off-screen rather than display:none, so it is still operable by
    // assistive technology that drives the control directly
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.append(input);

    const finish = (value) => {
      input.remove();
      resolve(value);
    };

    input.addEventListener('cancel', () => finish(null));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      try {
        finish({ text: await file.text(), handle: null, name: file.name });
      } catch (error) {
        input.remove();
        reject(error);
      }
    });

    input.click();
  });
}
