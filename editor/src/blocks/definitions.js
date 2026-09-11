/**
 * Block definitions for SPIKE Prime.
 *
 * Every block message is written to be read aloud. A screen reader announces
 * the block's text with its fields spliced in, so "drive forward for 25
 * centimetres" has to work as a spoken sentence, not just as a row of widgets.
 * That rules out the terse labels a purely visual editor can get away with --
 * a bare "cm" dropdown reads as the two letters, so the option says
 * "centimetres".
 */

import { Blockly } from '../blockly.js';

/** Ports, as the hub labels them. */
export const PORT_OPTIONS = [
  ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E'], ['F', 'F'],
];

/** Colours the sensor can report, paired with their `color` module constant. */
export const COLOR_OPTIONS = [
  ['black', 'BLACK'],
  ['white', 'WHITE'],
  ['red', 'RED'],
  ['green', 'GREEN'],
  ['blue', 'BLUE'],
  ['yellow', 'YELLOW'],
  ['magenta', 'MAGENTA'],
  ['purple', 'PURPLE'],
  ['azure', 'AZURE'],
  ['turquoise', 'TURQUOISE'],
  ['orange', 'ORANGE'],
  ['no colour', 'UNKNOWN'],
];

// Categories share a hue so the toolbox reads as groups. Colour is never the
// only signal for anything -- it is decoration over the block's own words.
const HUE = {
  events: 40,
  movement: 200,
  motor: 225,
  sensors: 140,
  display: 270,
  control: 20,
};

export const BLOCK_DEFINITIONS = [
  // -- events -------------------------------------------------------------
  {
    type: 'spike_when_started',
    message0: 'when the program starts',
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    colour: HUE.events,
    tooltip:
      'Everything inside this block runs when the program starts. ' +
      'A program needs one of these.',
    helpUrl: '',
  },

  // -- movement -----------------------------------------------------------
  {
    type: 'spike_move_for',
    message0: 'drive %1 for %2 %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIRECTION',
        options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']],
      },
      { type: 'input_value', name: 'AMOUNT', check: 'Number' },
      {
        type: 'field_dropdown',
        name: 'UNIT',
        options: [
          ['centimetres', 'CM'],
          ['rotations', 'ROTATIONS'],
          ['seconds', 'SECONDS'],
        ],
      },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip: 'Drive the robot in a straight line, then stop.',
  },
  {
    type: 'spike_turn_for',
    message0: 'turn %1 for %2 degrees',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIRECTION',
        options: [['left', 'LEFT'], ['right', 'RIGHT']],
      },
      { type: 'input_value', name: 'DEGREES', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip: 'Turn the robot on the spot. 90 degrees is a quarter turn.',
  },
  {
    type: 'spike_move_start',
    message0: 'start driving %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIRECTION',
        options: [['forward', 'FORWARD'], ['backward', 'BACKWARD']],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip: 'Start driving and keep going until something stops the robot.',
  },
  {
    type: 'spike_move_steer',
    message0: 'start driving with steering %1',
    args0: [{ type: 'input_value', name: 'STEERING', check: 'Number' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip:
      'Steering 0 drives straight. Negative steers left, positive steers right. ' +
      '100 or -100 spins on the spot.',
  },
  {
    type: 'spike_move_stop',
    message0: 'stop driving',
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip: 'Stop both driving motors.',
  },
  {
    type: 'spike_set_speed',
    message0: 'set driving speed to %1 percent',
    args0: [{ type: 'input_value', name: 'PERCENT', check: 'Number' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.movement,
    tooltip: 'Set how fast the driving blocks move the robot, from 0 to 100.',
  },

  // -- single motors ------------------------------------------------------
  {
    type: 'spike_motor_run_for_degrees',
    message0: 'run motor %1 for %2 degrees',
    args0: [
      { type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS },
      { type: 'input_value', name: 'DEGREES', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.motor,
    tooltip: 'Turn one motor by an exact number of degrees, then stop.',
  },
  {
    type: 'spike_motor_start',
    message0: 'start motor %1 at %2 percent',
    args0: [
      { type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS },
      { type: 'input_value', name: 'PERCENT', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.motor,
    tooltip: 'Start one motor and leave it running.',
  },
  {
    type: 'spike_motor_stop',
    message0: 'stop motor %1',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS }],
    previousStatement: null,
    nextStatement: null,
    colour: HUE.motor,
    tooltip: 'Stop one motor.',
  },

  // -- sensors ------------------------------------------------------------
  {
    type: 'spike_is_color',
    message0: 'colour sensor %1 sees %2',
    args0: [
      { type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS },
      { type: 'field_dropdown', name: 'COLOUR', options: COLOR_OPTIONS },
    ],
    inputsInline: true,
    output: 'Boolean',
    colour: HUE.sensors,
    tooltip: 'True when the colour sensor is looking at this colour.',
  },
  {
    type: 'spike_reflection',
    message0: 'reflected light at %1',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS }],
    output: 'Number',
    colour: HUE.sensors,
    tooltip:
      'How much light comes back, from 0 on black to about 95 on white. ' +
      'This is the value a line-following program follows.',
  },
  {
    type: 'spike_distance',
    message0: 'distance at %1 in millimetres',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS }],
    output: 'Number',
    colour: HUE.sensors,
    tooltip: 'How far away the nearest thing is. Minus one means nothing is in range.',
  },
  {
    type: 'spike_force_pressed',
    message0: 'force sensor %1 is pressed',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS }],
    output: 'Boolean',
    colour: HUE.sensors,
    tooltip: 'True while the force sensor is being pressed.',
  },
  {
    type: 'spike_motor_position',
    message0: 'position of motor %1',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORT_OPTIONS }],
    output: 'Number',
    colour: HUE.sensors,
    tooltip: 'How far this motor has turned, in degrees.',
  },

  // -- display and sound --------------------------------------------------
  {
    type: 'spike_write',
    message0: 'show %1 on the display',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.display,
    tooltip: 'Scroll text across the five by five display on the hub.',
  },
  {
    type: 'spike_display_clear',
    message0: 'clear the display',
    previousStatement: null,
    nextStatement: null,
    colour: HUE.display,
    tooltip: 'Turn off every light on the hub display.',
  },
  {
    type: 'spike_beep',
    message0: 'beep at %1 hertz for %2 seconds',
    args0: [
      { type: 'input_value', name: 'FREQUENCY', check: 'Number' },
      { type: 'input_value', name: 'SECONDS', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.display,
    tooltip: 'Play a note on the hub. 440 hertz is the A above middle C.',
  },
  {
    type: 'spike_print',
    message0: 'print %1',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.display,
    tooltip:
      'Send a message back from the hub. The editor reads printed messages ' +
      'out loud, so this is how your program can tell you what it is doing.',
  },

  // -- control ------------------------------------------------------------
  {
    type: 'spike_wait_seconds',
    message0: 'wait %1 seconds',
    args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.control,
    tooltip: 'Pause the program for a while. Motors keep doing what they were doing.',
  },
  {
    type: 'spike_wait_until',
    message0: 'wait until %1',
    args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: HUE.control,
    tooltip: 'Pause the program until this becomes true.',
  },
];

let defined = false;

/** Register every SPIKE block with Blockly. Safe to call more than once. */
export function defineSpikeBlocks() {
  if (defined) return;
  Blockly.common.defineBlocks(
    Blockly.common.createBlockDefinitionsFromJsonArray(BLOCK_DEFINITIONS),
  );
  defined = true;
}
