/**
 * Building workspaces in tests.
 *
 * Blockly's API for assembling blocks by hand is verbose enough that a test
 * written directly against it hides what it is testing. These helpers let a
 * test read like the program a student would drag together.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import 'blockly/blocks'; // registers math_number, text, controls_if, ...
import { Blockly } from '../src/blockly.js';
import { defineSpikeBlocks } from '../src/blocks/definitions.js';
import { generateProgram } from '../src/generators/python.js';

const run = promisify(execFile);

const SIMULATOR_DIR = fileURLToPath(new URL('../../spike-sim', import.meta.url));

// -- building blocks --------------------------------------------------------

/** A block spec: `{type, fields, values, statements}`. */
export const block = (type, spec = {}) => ({ type, ...spec });

/** A number shadow-equivalent, for value inputs. */
export const num = (value) => block('math_number', { fields: { NUM: String(value) } });

/** A text value. */
export const str = (value) => block('text', { fields: { TEXT: String(value) } });

function create(workspace, spec) {
  const instance = workspace.newBlock(spec.type);

  for (const [name, value] of Object.entries(spec.fields ?? {})) {
    instance.setFieldValue(value, name);
  }

  for (const [name, child] of Object.entries(spec.values ?? {})) {
    const input = instance.getInput(name);
    if (!input) throw new Error(`${spec.type} has no value input named ${name}`);
    input.connection.connect(create(workspace, child).outputConnection);
  }

  for (const [name, chain] of Object.entries(spec.statements ?? {})) {
    const input = instance.getInput(name);
    if (!input) throw new Error(`${spec.type} has no statement input named ${name}`);
    connectChain(workspace, input.connection, chain);
  }

  return instance;
}

function connectChain(workspace, connection, specs) {
  let previous = connection;
  for (const spec of [].concat(specs)) {
    const instance = create(workspace, spec);
    previous.connect(instance.previousConnection);
    previous = instance.nextConnection;
  }
}

/**
 * Build a workspace whose single "when the program starts" block contains
 * the given statements.
 */
export function programWorkspace(...statements) {
  defineSpikeBlocks();
  const workspace = new Blockly.Workspace();
  create(workspace, block('spike_when_started', { statements: { DO: statements } }));
  return workspace;
}

/** Build a program and generate it, in one step. */
export function generate(...statements) {
  const workspace = programWorkspace(...statements);
  try {
    return generateProgram(workspace);
  } finally {
    workspace.dispose();
  }
}

/** Just the generated source. */
export const codeFor = (...statements) => generate(...statements).code;

/** The body of `async def main()`, with its indentation stripped. */
export function bodyOf(code) {
  const lines = code.split('\n');
  const start = lines.findIndex((line) => line.startsWith('async def main():'));
  if (start < 0) throw new Error('generated program has no main()');

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (!line.startsWith('    ')) break; // back out to module level
    body.push(line.slice(4));
  }
  return body.join('\n');
}

// -- running generated programs in the simulator ----------------------------

/**
 * Run generated Python in the hub simulator and report what the robot did.
 *
 * This is the test that matters. Asserting on generated text only proves the
 * generator is self-consistent; running it proves the blocks mean what they
 * say. The simulator speaks the real hub protocol, so a program that behaves
 * here is a program that should behave on hardware.
 *
 * @param {string} code generated SPIKE MicroPython
 * @param {{speed?: number, world?: string, timeoutMs?: number}} [options]
 */
export async function runInSimulator(code, options = {}) {
  const { speed = 200, world, timeoutMs = 60_000 } = options;

  const directory = await mkdtemp(join(tmpdir(), 'blockly-for-lego-'));
  const programPath = join(directory, 'program.py');
  await writeFile(programPath, code, 'utf8');

  const args = ['-m', 'spike_sim', '--run', programPath, '--json', '--speed', String(speed)];
  if (world) args.push('--world', world);

  try {
    let stdout = '';
    try {
      ({ stdout } = await run('python3', args, {
        cwd: SIMULATOR_DIR,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      }));
    } catch (error) {
      // a non-zero exit means the program errored; the output still has the
      // events explaining why, which is exactly what a test wants to assert on
      if (error.stdout === undefined) throw error;
      stdout = error.stdout;
    }

    const lines = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const final = lines.find((entry) => entry.type === 'final');
    const events = lines.filter((entry) => entry.type !== 'final');

    if (!final) {
      throw new Error(`simulator produced no final state:\n${stdout}`);
    }

    return {
      events,
      failed: final.failed,
      robot: final.robot,
      pose: final.robot.pose,
      /** Everything printed by the program, in order. */
      printed: events
        .filter((entry) => entry.kind === 'console')
        .map((entry) => entry.data.text),
      /** The narration, as a student would hear it. */
      narration: events.map((entry) => entry.message),
      errors: events.filter((entry) => entry.kind === 'error').map((entry) => entry.message),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Build, generate and run, in one step. */
export async function runProgram(statements, options) {
  const { code, warnings } = generate(...[].concat(statements));
  const result = await runInSimulator(code, options);
  return { ...result, code, warnings };
}
