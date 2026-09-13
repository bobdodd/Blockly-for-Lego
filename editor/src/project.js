/**
 * What a saved program is.
 *
 * Blockly hands you the blocks as JSON and has no opinion about where it
 * goes. This module decides the rest: what a file contains, how it is read
 * back, and what to say when it cannot be.
 *
 * Two decisions here are not cosmetic.
 *
 * **A file records the robot, not only the blocks.** The same blocks mean
 * different distances on a different driving base — "drive 25 centimetres"
 * becomes motor degrees using the wheel diameter and the axle track. A file
 * that did not say which robot it was made for would be a trap, and we have
 * already been caught by exactly that arithmetic once.
 *
 * **And the mat, for the same reason one step up.** The mat is the exercise:
 * "following a straight line from the green square to the red one" is the
 * specification, and the blocks are the answer to it. A line follower opened
 * onto an empty floor is a program that looks broken and is not, which is the
 * same trap the robot was, so a file says which mat it was written for.
 *
 * The robot and the mat are then treated differently on opening, because they
 * are different kinds of thing. The robot is the machine on the table and a
 * file cannot change it, so a mismatch is said and left alone. The mat is
 * only ever a description of a world the simulator builds, so a file can
 * simply ask for it — and the picker still moves it afterwards.
 *
 * **Block types are permanent.** Blockly's loader fails on a type it does not
 * recognise, so renaming a block silently breaks every file a student has
 * saved. `version` exists to hang a migration on if that ever becomes
 * unavoidable; the policy is that it should not.
 *
 * No DOM here, so it can be tested as plain data.
 */

/** Marks a file as ours, so opening the wrong JSON gives a clear answer. */
export const PROGRAM_FORMAT = 'blockly-for-lego.program';

/** Bump only alongside a migration in {@link parseProject}. */
export const PROGRAM_VERSION = 1;

export const DEFAULT_NAME = 'My program';

/**
 * Build the object that gets written to a file.
 *
 * @param {{name?: string, blocks: object, robot: object, mat?: string}} program
 * @returns {object}
 */
export function buildProject({ name, blocks, robot, mat }) {
  return {
    format: PROGRAM_FORMAT,
    version: PROGRAM_VERSION,
    name: cleanName(name),
    savedAt: new Date().toISOString(),
    robot: {
      wheelDiameterMm: robot.wheelDiameterMm,
      axleTrackMm: robot.axleTrackMm,
      leftPort: robot.leftPort,
      rightPort: robot.rightPort,
    },
    // The mat this was written against, by name. Added without bumping
    // PROGRAM_VERSION on purpose: an older file simply has no mat and opens
    // exactly as it did, and a newer file opened by an older editor carries a
    // field it ignores. Neither needs a migration, which is what the version
    // is for.
    ...(mat ? { mat } : {}),
    blocks,
  };
}

/** The text of a saved file. Indented, because a person may well read it. */
export function serialiseProject(program) {
  return `${JSON.stringify(buildProject(program), null, 2)}\n`;
}

/**
 * Read a file back.
 *
 * Never throws for a bad file: a student opening the wrong thing should get a
 * sentence they can act on, not a stack trace. Problems that prevent loading
 * come back as `error`; problems worth mentioning come back as `warnings`.
 *
 * @param {string} text file contents
 * @param {{knownBlockTypes?: Iterable<string>, robot?: object,
 *          knownMats?: Iterable<string>}} [context]
 * @returns {{project: object|null, error: string|null, warnings: string[]}}
 */
export function parseProject(text, context = {}) {
  const warnings = [];

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      project: null,
      warnings,
      error: 'That file is not a saved program — it is not even JSON.',
    };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { project: null, warnings, error: 'That file does not contain a program.' };
  }

  if (data.format !== PROGRAM_FORMAT) {
    return {
      project: null,
      warnings,
      error:
        'That file was not saved by this editor. Look for a file you saved from ' +
        'the Save button.',
    };
  }

  if (typeof data.version !== 'number' || data.version > PROGRAM_VERSION) {
    return {
      project: null,
      warnings,
      error:
        `That program was saved by a newer version of the editor (file version ` +
        `${data.version}, this editor understands ${PROGRAM_VERSION}). Update the ` +
        `editor and try again.`,
    };
  }

  if (!data.blocks || typeof data.blocks !== 'object') {
    return { project: null, warnings, error: 'That program has no blocks in it.' };
  }

  // Checked before handing anything to Blockly: its loader throws on an
  // unknown type and can leave half a program on the canvas, so the student
  // would lose what they had open and get no idea why.
  const known = context.knownBlockTypes ? new Set(context.knownBlockTypes) : null;
  if (known) {
    const missing = [...usedBlockTypes(data.blocks)].filter((type) => !known.has(type));
    if (missing.length > 0) {
      return {
        project: null,
        warnings,
        error:
          `That program uses ${missing.length === 1 ? 'a block' : 'blocks'} this ` +
          `editor does not have: ${missing.join(', ')}. It may have been saved by a ` +
          `different version.`,
      };
    }
  }

  if (context.robot && data.robot) {
    warnings.push(...robotDifferences(data.robot, context.robot));
  }

  // A mat this editor no longer has is worth saying, because the caller is
  // about to lay out something else and the program will look broken on it.
  const mat = typeof data.mat === 'string' ? data.mat : null;
  const knownMats = context.knownMats ? new Set(context.knownMats) : null;
  const matIsKnown = mat !== null && (!knownMats || knownMats.has(mat));
  if (mat !== null && !matIsKnown) {
    warnings.push(
      `This program was written for a mat called ${mat}, which this editor does ` +
        `not have. It will run on whichever mat is laid out, and may not do what ` +
        `it looks like it should.`,
    );
  }

  return {
    project: {
      name: cleanName(data.name),
      robot: data.robot ?? null,
      mat: matIsKnown ? mat : null,
      blocks: data.blocks,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : null,
    },
    error: null,
    warnings,
  };
}

/**
 * Every block type a saved program uses.
 * Walks the serialized tree rather than assuming a shape, because blocks nest
 * through several different keys.
 */
export function usedBlockTypes(blocks) {
  const types = new Set();

  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') types.add(node.type);
    for (const value of Object.values(node)) walk(value);
  };

  walk(blocks);
  return types;
}

/**
 * Say where a saved robot differs from the one now configured.
 *
 * Not an error — the program still loads and still runs. But every distance
 * and every turn it makes will be out by the ratio of these numbers, which is
 * the kind of wrongness that looks like bad driving rather than bad setup.
 */
function robotDifferences(saved, current) {
  const differences = [];

  if (number(saved.wheelDiameterMm) && saved.wheelDiameterMm !== current.wheelDiameterMm) {
    differences.push(
      `This program was made for ${saved.wheelDiameterMm}mm wheels; this editor is ` +
        `set up for ${current.wheelDiameterMm}mm, so every distance will be out by ` +
        `about ${percentDifference(saved.wheelDiameterMm, current.wheelDiameterMm)}.`,
    );
  }

  if (number(saved.axleTrackMm) && saved.axleTrackMm !== current.axleTrackMm) {
    differences.push(
      `This program was made for a robot with its wheels ${saved.axleTrackMm}mm ` +
        `apart; this editor is set up for ${current.axleTrackMm}mm, so every turn ` +
        `will be out by about ` +
        `${percentDifference(saved.axleTrackMm, current.axleTrackMm)}.`,
    );
  }

  const savedPorts = [saved.leftPort, saved.rightPort].filter(Boolean).join(' and ');
  const currentPorts = [current.leftPort, current.rightPort].filter(Boolean).join(' and ');
  if (savedPorts && currentPorts && savedPorts !== currentPorts) {
    differences.push(
      `This program drives with motors on ports ${savedPorts}; this editor is set ` +
        `up for ${currentPorts}.`,
    );
  }

  return differences;
}

const number = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function percentDifference(from, to) {
  return `${Math.round(Math.abs(from - to) / to * 100)} percent`;
}

/** A usable program name, whatever we were handed. */
export function cleanName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.slice(0, 80) || DEFAULT_NAME;
}

/**
 * A filename for a program name.
 * Kept plain: spaces and punctuation travel badly between a Chromebook, a
 * network drive and a memory stick.
 */
export function fileNameFor(name) {
  const slug = cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'program'}.json`;
}
