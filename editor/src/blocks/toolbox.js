/**
 * The toolbox.
 *
 * Every value input carries a shadow block holding a sensible default, so a
 * block arrives ready to run. That matters more here than in a mouse-driven
 * editor: filling an empty socket by keyboard is several extra moves, and a
 * block that does nothing until you find and fill its hole is a poor first
 * experience.
 *
 * Categories are ordered by when a class meets them, not alphabetically.
 */

const number = (value) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
const text = (value) => ({ shadow: { type: 'text', fields: { TEXT: value } } });

export const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Start',
      colour: '40',
      contents: [{ kind: 'block', type: 'spike_when_started' }],
    },
    {
      kind: 'category',
      name: 'Movement',
      colour: '200',
      contents: [
        {
          kind: 'block',
          type: 'spike_move_for',
          fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
          inputs: { AMOUNT: number(25) },
        },
        {
          kind: 'block',
          type: 'spike_turn_for',
          fields: { DIRECTION: 'RIGHT' },
          inputs: { DEGREES: number(90) },
        },
        { kind: 'block', type: 'spike_move_start', fields: { DIRECTION: 'FORWARD' } },
        { kind: 'block', type: 'spike_move_steer', inputs: { STEERING: number(0) } },
        { kind: 'block', type: 'spike_move_stop' },
        { kind: 'block', type: 'spike_set_speed', inputs: { PERCENT: number(50) } },
      ],
    },
    {
      kind: 'category',
      name: 'Motors',
      colour: '225',
      contents: [
        {
          kind: 'block',
          type: 'spike_motor_run_for_degrees',
          fields: { PORT: 'A' },
          inputs: { DEGREES: number(90) },
        },
        {
          kind: 'block',
          type: 'spike_motor_start',
          fields: { PORT: 'A' },
          inputs: { PERCENT: number(50) },
        },
        { kind: 'block', type: 'spike_motor_stop', fields: { PORT: 'A' } },
      ],
    },
    {
      kind: 'category',
      name: 'Sensors',
      colour: '140',
      contents: [
        { kind: 'block', type: 'spike_is_color', fields: { PORT: 'C', COLOUR: 'BLACK' } },
        { kind: 'block', type: 'spike_reflection', fields: { PORT: 'C' } },
        { kind: 'block', type: 'spike_distance', fields: { PORT: 'D' } },
        { kind: 'block', type: 'spike_force_pressed', fields: { PORT: 'E' } },
        { kind: 'block', type: 'spike_motor_position', fields: { PORT: 'A' } },
      ],
    },
    {
      kind: 'category',
      name: 'Sound and display',
      colour: '270',
      contents: [
        { kind: 'block', type: 'spike_print', inputs: { TEXT: text('hello') } },
        { kind: 'block', type: 'spike_write', inputs: { TEXT: text('Hi') } },
        { kind: 'block', type: 'spike_display_clear' },
        {
          kind: 'block',
          type: 'spike_beep',
          inputs: { FREQUENCY: number(440), SECONDS: number(0.5) },
        },
      ],
    },
    {
      kind: 'category',
      name: 'Control',
      colour: '20',
      contents: [
        { kind: 'block', type: 'spike_wait_seconds', inputs: { SECONDS: number(1) } },
        { kind: 'block', type: 'spike_wait_until' },
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: number(4) } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_if' },
      ],
    },
    {
      kind: 'category',
      name: 'Maths and logic',
      colour: '230',
      contents: [
        { kind: 'block', type: 'math_number', fields: { NUM: 0 } },
        {
          kind: 'block',
          type: 'math_arithmetic',
          inputs: { A: number(1), B: number(1) },
        },
        {
          kind: 'block',
          type: 'logic_compare',
          inputs: { A: number(0), B: number(0) },
        },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'text', fields: { TEXT: 'hello' } },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      colour: '330',
      custom: 'VARIABLE',
    },
  ],
};

/** A program that is ready to run, so the editor never opens on a blank page. */
export const STARTER_PROGRAM = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'spike_when_started',
        x: 40,
        y: 40,
        inputs: {
          DO: {
            block: {
              type: 'spike_print',
              inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } },
              next: {
                block: {
                  type: 'spike_move_for',
                  fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
                  inputs: { AMOUNT: { shadow: { type: 'math_number', fields: { NUM: 25 } } } },
                  next: {
                    block: {
                      type: 'spike_turn_for',
                      fields: { DIRECTION: 'RIGHT' },
                      inputs: {
                        DEGREES: { shadow: { type: 'math_number', fields: { NUM: 90 } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
};
