/**
 * What the Help panel says.
 *
 * Content as data, not markup. Two reasons, and the second is the one that
 * matters: a topic is rendered into real elements by src/help-panel.js, so
 * headings are headings and steps are an ordered list, which is what a
 * student moving by heading or by list item is relying on. Prose with tags
 * written through it tends to become prose with tags written wrongly through
 * it.
 *
 * Three kinds of thing are never written here, because they are already known
 * somewhere else and a second copy is a copy that goes stale:
 *
 *  - **Key names** come from the shortcut table, so they say Cmd on a Mac.
 *  - **The blocks** are read from the toolbox and their own tooltips.
 *  - **The robots and mats** are read from the catalogues the simulator
 *    generates, so a mat added there appears here without anyone noticing.
 *
 * Written for a student who may never have programmed, and who may be hearing
 * this rather than reading it. Short sentences. No screenshot ever referred
 * to. Nothing that assumes you can see where a thing is on the screen.
 */

import { toolbox } from './blocks/toolbox.js';
import { BLOCK_DEFINITIONS } from './blocks/definitions.js';
import { MATS } from './generated/mat-catalogue.js';
import { ROBOTS } from './generated/robot-catalogue.js';
import { EXAMPLES } from './generated/examples.js';
import { block, both } from './guided.js';

/* ------------------------------------------------------------------ *
 * Topics that are written.
 * ------------------------------------------------------------------ */

const WHAT_THIS_IS = {
  id: 'what-this-is',
  title: 'What this is',
  body: [
    { p: 'This is a place to write programs for a LEGO SPIKE Prime robot by '
      + 'joining blocks together instead of typing code.' },
    { p: 'You build a program out of blocks. The editor turns it into Python — '
      + 'the same Python a person would write by hand — and sends it to a '
      + 'robot. The robot can be a real one on the table, or a simulated one '
      + 'that lives in this page. Both are sent exactly the same program.' },
    { h: 'It tells you what it is doing' },
    { p: 'Everything the robot does is said out loud in writing, in the list '
      + 'called "What the robot is doing". "The robot drove 25 centimetres." '
      + '"The colour sensor now sees red." That list is the point of this '
      + 'editor, not a log added to the side of it: it is how you find out '
      + 'what happened without watching.' },
    { p: 'The robot view can also speak, describing the mat from above and '
      + 'narrating the run as it happens. That is the "Spoken commentary" '
      + 'panel, and it can be turned off.' },
    { h: 'Everything works from the keyboard' },
    { p: 'There is nothing here you need a mouse for. Press the key below at '
      + 'any time, including while you are in the middle of the blocks, to '
      + 'see every key this editor and Blockly understand.' },
    { keys: 'help', what: 'the list of every key' },
  ],
};

const FIRST_PROGRAM = {
  id: 'first-program',
  title: 'Your first program',
  body: [
    { p: 'This makes the robot drive forward and say so. It takes about a '
      + 'minute, and needs nothing set up.' },
    { steps: [
      'Press "Connect to simulator". Wait a few seconds. It will say '
        + '"Connected to the built-in simulator." Nothing is installed and '
        + 'nothing is downloaded that you have to manage.',
      'Move into the blocks. From the toolbox, take the "when the program '
        + 'starts" block from the Start category. Every program needs one, '
        + 'and everything else goes inside it.',
      'From Movement, take "drive forward for 25 centimetres" and put it '
        + 'inside the "when the program starts" block.',
      'Press Run.',
    ] },
    { p: 'The robot drives, and "What the robot is doing" fills up:' },
    { quote: 'The robot is driving 25 centimetres.\n'
      + 'The robot drove 25 centimetres. The robot is 55 centimetres from the '
      + 'west edge and 57 centimetres from the south edge, pointing east.' },
    { h: 'The keys worth knowing now' },
    { keys: 'run', what: 'Run the program' },
    { keys: 'stop', what: 'Stop it' },
    { keys: 'silence', what: 'Stop the talking, without stopping the robot' },
    { p: 'Run and Stop work while you are inside the blocks, which is where '
      + 'you will be.' },
    { h: 'Then try changing it' },
    { p: 'Change 25 to 50 and run it again. The robot goes twice as far, and '
      + 'says so. Add a "turn right for 90 degrees" underneath and run it '
      + 'again. This is the whole loop: change a block, run it, listen to '
      + 'what changed.' },
  ],
};

const RUNNING = {
  id: 'running',
  title: 'Running your program',
  body: [
    { p: 'Nothing runs until you are connected to something to run it on. '
      + 'There are two things you can connect to, and they behave the same '
      + 'way once you are.' },
    { h: 'The simulator' },
    { p: 'Press "Connect to simulator". This always works, on any machine, '
      + 'with nothing installed — the simulator runs inside this page. Give '
      + 'it a few seconds the first time while it unpacks itself.' },
    { h: 'A real hub' },
    { p: 'Press "Connect to a hub" and pick your hub from the list the '
      + 'browser shows. This needs Chrome or Edge: Safari and Firefox do not '
      + 'have the Bluetooth support it uses, and no browser on an iPad does.' },
    { h: 'Running, stopping, and getting quiet' },
    { keys: 'run', what: 'Run the program' },
    { keys: 'stop', what: 'Stop the program' },
    { keys: 'silence', what: 'Stop the talking. The robot keeps going.' },
    { note: 'Stopping the talking is not stopping the robot. If the robot is '
      + 'moving and you want it to stop, use Stop.' },
    { h: 'What you will hear' },
    { p: 'While it runs, "What the robot is doing" is written to as things '
      + 'happen. It is a polite live region, so a screen reader reads new '
      + 'lines without taking you away from what you were doing.' },
    { p: 'Anything that changes what you can do next — connected, '
      + 'disconnected, started, stopped, an error — interrupts instead, '
      + 'because it is worth interrupting for.' },
  ],
};

const THE_SIMULATOR = {
  id: 'the-simulator',
  title: 'The simulator',
  body: [
    { p: 'The simulator is a SPIKE Prime hub made of software. It runs the '
      + 'same Python your blocks turn into, against a robot with real '
      + 'measurements driving on a mat with real dimensions, and it says what '
      + 'happens.' },
    { p: 'It exists so that a program can be written, run, and understood '
      + 'without a robot on the table and without anyone watching it.' },
    { h: 'It is not pretending to be perfect' },
    { p: 'The simulator is predictable rather than realistic. A wheel does '
      + 'not slip, a battery does not go flat, and the same program run twice '
      + 'does the same thing twice. That is on purpose: a program that works '
      + 'here and not on the table is a robot problem, which is worth knowing '
      + 'about separately.' },
    { h: 'It fails loudly' },
    { p: 'If your program asks for something the simulator does not know how '
      + 'to do, it stops and says which call it was. It does not quietly '
      + 'return a plausible number, because a gap you cannot see is a gap you '
      + 'find out about on the robot instead.' },
    { h: 'Two of them' },
    { p: 'There is one built into this page, and there is one you can start '
      + 'yourself in a terminal. If you have started your own and this editor '
      + 'is running on the same machine, "Connect to simulator" finds that one '
      + 'first — its narration then appears in your terminal as well as here. '
      + 'Otherwise the built-in one is used. Both are the same Python, and it '
      + 'says which one answered.' },
    { note: 'A simulator you started yourself has whatever mat it was given '
      + 'when it started, and the mat picker here cannot change it. The '
      + 'editor says so when that happens.' },
  ],
};

const SAVING = {
  id: 'saving',
  title: 'Saving and opening',
  body: [
    { keys: 'save', what: 'Save' },
    { keys: 'saveAs', what: 'Save as a new file' },
    { p: 'A saved program is a file you keep — on your machine, in your '
      + 'documents, wherever you put it. Nothing is stored on a server and '
      + 'nothing needs an account.' },
    { h: 'A file remembers more than the blocks' },
    { p: 'It also records which robot and which mat it was written for. That '
      + 'is not bookkeeping. "Drive 25 centimetres" becomes a number of motor '
      + 'degrees using the wheel size, so the same blocks mean a different '
      + 'distance on a robot with different wheels. Opening a program made '
      + 'for another robot tells you so, and by how much.' },
    { p: 'The mat is treated differently: opening a program lays out the mat '
      + 'it was written for, because the mat is the exercise and the blocks '
      + 'are the answer to it. You can still change it afterwards.' },
    { h: 'The browser also keeps a copy' },
    { p: 'Your work comes back if you close the tab by accident. That is '
      + 'crash protection, not saving — it lives in one browser on one '
      + 'machine and goes when the site data is cleared. Save a file for '
      + 'anything you want to keep.' },
  ],
};

const LISTENING = {
  id: 'listening',
  title: 'Hearing what happens',
  body: [
    { p: 'There are three different things that can tell you what the robot '
      + 'did, and they are for different moments.' },
    { h: 'What the robot is doing' },
    { p: 'A written list, added to as the program runs, below the panel on '
      + 'the right. It is never hidden behind a tab. This is the one to '
      + 'follow while a program runs.' },
    { h: 'Spoken commentary' },
    { p: 'The robot view can speak: it describes the mat from above before a '
      + 'run, calls out what the robot does during it, and sums up at the '
      + 'end. It uses the browser’s own voice, so it can talk while you '
      + 'are reading something else.' },
    { p: 'You can choose the voice, the speed and the volume. Turn the speech '
      + 'off and the same words go to your screen reader instead.' },
    { note: 'If it says it is speaking and you hear nothing, the browser is '
      + 'probably blocking sound for this site. Open the padlock in the '
      + 'address bar, then Site settings, and allow Sound and Autoplay. '
      + 'Chrome does this silently, with no error. "Test the voice" is there '
      + 'to find out.' },
    { h: 'The mat is described from above' },
    { p: 'Everything spoken about the scene is from above, like a map, using '
      + 'north, south, east and west — never "the robot’s left". The mat '
      + 'has a north arrow printed on it, so the words match the thing on the '
      + 'table. "The robot is 55 centimetres from the west edge, pointing '
      + 'east" means the same to everybody in the room.' },
  ],
};

const STUCK = {
  id: 'stuck',
  title: 'When something goes wrong',
  body: [
    { h: 'Run does nothing' },
    { p: 'You are probably not connected. Press "Connect to simulator" and '
      + 'wait for it to say it is connected. Run stays switched off until '
      + 'there is something to run on.' },
    { h: 'The program starts and then nothing happens' },
    { p: 'Look for a loop with nothing inside it that takes any time. '
      + '"Start driving" sets the motors going and finishes immediately, so a '
      + 'loop containing only blocks like that goes round for ever without '
      + 'letting the robot move. Put a "wait" block inside the loop — a tenth '
      + 'of a second is plenty.' },
    { h: 'It drives the wrong distance' },
    { p: 'Check the robot picker matches the robot you actually built. '
      + 'Distances are worked out from the wheel size, so the wrong wheels '
      + 'mean the wrong distance, and nothing about the program looks wrong.' },
    { h: 'It says it is speaking and I hear nothing' },
    { p: 'The browser is blocking sound for this site. Open the padlock in '
      + 'the address bar, then Site settings, and allow Sound and Autoplay.' },
    { h: '"Connect to a hub" is not offered' },
    { p: 'The browser does not have Web Bluetooth. Use Chrome or Edge on '
      + 'Windows, macOS, Linux or ChromeOS. It does not exist in Safari or '
      + 'Firefox, or in any browser on an iPad. The simulator still works '
      + 'everywhere.' },
    { h: 'A file will not open' },
    { p: 'The editor says why rather than failing quietly — the wrong kind of '
      + 'file, or a block it does not know. A program saved by a newer '
      + 'version of the editor can use a block this one has never heard of.' },
  ],
};

/* ------------------------------------------------------------------ *
 * Topics that are read from somewhere else.
 * ------------------------------------------------------------------ */

/** Every block, by category, described by its own tooltip. */
function blocksTopic() {
  const tooltips = new Map(
    BLOCK_DEFINITIONS.map((definition) => [definition.type, definition.tooltip]),
  );

  const body = [
    { p: 'The blocks are grouped in the toolbox in the order a class meets '
      + 'them, not alphabetically. Every block below is described by the same '
      + 'words the block itself will tell you if you ask it.' },
    { note: 'On a block, Ctrl+J reads its tooltip and I describes the block '
      + 'you are on. Those come from Blockly, and the keyboard help lists '
      + 'them with the right keys for your machine.' },
  ];

  for (const category of toolbox.contents ?? []) {
    const entries = (category.contents ?? [])
      .map((entry) => entry.type)
      .filter(Boolean);
    if (entries.length === 0) continue;

    body.push({ h: category.name });
    body.push({
      terms: entries.map((type) => [
        blockLabel(type),
        tooltips.get(type) ?? 'One of Blockly’s own blocks.',
      ]),
    });
  }

  return { id: 'the-blocks', title: 'The blocks', body };
}

/**
 * A block's words, with the placeholders taken out.
 *
 * `message0` is "drive %1 for %2 %3", which is the block as it is built
 * rather than as it is read. The numbered holes are where the dropdowns and
 * the sockets go, and a list of blocks reads better without them.
 */
function blockLabel(type) {
  const definition = BLOCK_DEFINITIONS.find((entry) => entry.type === type);
  const message = definition?.message0;
  if (!message) return type.replace(/^spike_|^controls_|^logic_|^math_/, '').replace(/_/g, ' ');
  return message.replace(/%\d+/g, '…').replace(/\s+/g, ' ').trim();
}

/** The robots and mats, from the catalogues the simulator generates. */
function worldTopic() {
  return {
    id: 'robots-and-mats',
    title: 'Robots and mats',
    body: [
      { p: 'Two pickers decide what the simulator builds: which robot, and '
        + 'which mat it drives on.' },
      { h: 'The robot' },
      { p: 'The robot is the machine. Its wheel size and how far apart the '
        + 'wheels are decide what "drive 25 centimetres" and "turn 90 '
        + 'degrees" actually do, so this has to match the robot you built.' },
      { terms: ROBOTS.map((robot) => [robot.title, robot.teaches]) },
      { note: 'Measure your own robot rather than guessing. A driving base '
        + 'that cannot be built out of real parts is easy to describe and '
        + 'impossible to drive, and the numbers are the only thing the '
        + 'program has to go on.' },
      { h: 'The mat' },
      { p: 'The mat is the exercise: what is printed on it is the problem the '
        + 'program is meant to solve.' },
      { terms: MATS.map((mat) => [mat.title, mat.teaches]) },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Tutorials.
 * ------------------------------------------------------------------ */

const TUTORIALS = [
  {
    id: 'tutorial-square',
    title: 'Tutorial 1: Drive a square',
    example: 'drive-square',
    guided: [
      {
        keys: "You are already in the toolbox, on Start. Press the right arrow to go into its list of blocks. You hear \u201cwhen the program starts\u201d. Press Enter to take it. It says it is moving the block on the workspace \u2014 press Enter again to put it down.",
        keysHint: "The right arrow goes into a category\u2019s blocks; the left arrow comes back out. Enter takes the block, and Enter again accepts where it is going. If you have wandered off, T brings you back to the toolbox from anywhere in the editor.",
        say: 'Take a "when the program starts" block from the Start category '
          + 'and put it in the workspace.',
        hint: 'It is the only block in Start. Everything else goes inside it.',
        done: block('spike_when_started'),
      },
      {
        keys: "Press T, arrow down to Movement, right arrow into its blocks, then arrow down until you hear \u201cset driving speed to 50 percent\u201d. Press Enter to take it. It will say \u201cmoving set driving speed inside when the program starts\u201d \u2014 that is where you want it, so press Enter to accept. Then press the right arrow twice to reach the number, Enter to open it, type 40, and Enter again.",
        keysHint: "Listen to what it says after the first Enter. It names the block and where it is about to go. If that is not where you want it, use the arrow keys before you accept.",
        say: 'Inside it, put "set driving speed to 40 percent" from Movement. '
          + 'Change the 50 to 40.',
        hint: 'The block arrives saying 50. Move onto the number and type 40.',
        done: block('spike_set_speed', {
          inside: 'spike_when_started',
          number: ['PERCENT', 40],
        }),
      },
      {
        keys: "Press T, arrow down to Control, right arrow in, arrow down to \u201crepeat 4 times\u201d, Enter to take it. It should say inside \u201cwhen the program starts\u201d. If it says it is going inside the speed block instead, press the down arrow until it says after it, then Enter.",
        keysHint: "While you are placing a block the arrow keys change where it will land, and it says the new place each time. Escape puts it back if you change your mind.",
        say: 'Under the speed block, still inside "when the program starts", '
          + 'put a "repeat 4 times" block from Control.',
        hint: 'It arrives saying 4 already, so only its position needs doing.',
        done: block('controls_repeat_ext', {
          inside: 'spike_when_started',
          number: ['TIMES', 4],
        }),
      },
      {
        keys: "Press T, arrow down to Movement, right arrow in, arrow down to \u201cdrive forward for 25 centimetres\u201d, Enter. Now listen: it must say inside the repeat block. Use the arrow keys until it does, then Enter.",
        keysHint: "Inside the repeat and after it sound almost the same and are completely different. \u201cInside\u201d is the word to listen for.",
        say: 'Inside the repeat, put "drive forward for 25 centimetres".',
        hint: 'Inside the repeat, not under it. It arrives forward, 25, '
          + 'centimetres — so it only has to go in the right place.',
        done: block('spike_move_for', {
          inside: 'controls_repeat_ext',
          fields: { DIRECTION: 'FORWARD', UNIT: 'CM' },
          number: ['AMOUNT', 25],
        }),
      },
      {
        keys: "Press T, Movement, right arrow in, arrow down to \u201cturn right for 90 degrees\u201d, Enter. It should say after the drive block and inside the repeat. Arrow until it does, then Enter.",
        keysHint: "If you lose track of where you are, press I to be told, or Shift and I for more detail.",
        say: 'Under the drive block and still inside the repeat, put "turn '
          + 'right for 90 degrees".',
        hint: 'It must come after the drive block, so the robot drives a side '
          + 'and then turns the corner.',
        done: block('spike_turn_for', {
          inside: 'controls_repeat_ext',
          under: 'spike_move_for',
          fields: { DIRECTION: 'RIGHT' },
          number: ['DEGREES', 90],
        }),
      },
      {
        keys: "Press T, arrow down to Sound and display, right arrow in, arrow down to \u201cprint\u201d, Enter. This one goes after the repeat, not inside it \u2014 arrow until it says after the repeat block, then Enter.",
        keysHint: "Outside the repeat means it happens once. Inside, it would happen four times.",
        say: 'Last, under the repeat but outside it, put a "print" block from '
          + 'Sound and display. Put any words you like in it.',
        hint: 'Outside the repeat: it should happen once at the end, not four '
          + 'times.',
        done: block('spike_print', {
          inside: 'spike_when_started',
          notInside: 'controls_repeat_ext',
        }),
      },
    ],
    body: [
      { p: 'Four sides and four turns, ending exactly where it began. This is '
        + 'the first thing worth making a robot do, because whether it worked '
        + 'is something you can check by listening.' },
      { h: 'Set it up' },
      { steps: [
        'Set the mat picker to "Open floor" — nothing to run into.',
        'Set the robot picker to "Standard base".',
        'Press "Connect to simulator".',
      ] },
      { h: 'Build it' },
      { steps: [
        'Start with "when the program starts".',
        'Inside it, "set driving speed to 40 percent".',
        'Under that, a "repeat 4 times" block from Control.',
        'Inside the repeat: "drive forward for 25 centimetres", and under '
          + 'that "turn right for 90 degrees".',
        'Under the repeat, outside it, a "print" block saying anything you '
          + 'like. It tells you the program reached the end.',
      ] },
      { h: 'Run it' },
      { p: 'The narration counts out four drives and four turns. At the end '
        + 'the robot is back where it started, pointing the way it began, '
        + 'having travelled one metre.' },
      { h: 'Then break it on purpose' },
      { p: 'Change the turn from 90 degrees to 60 and run it again. The robot '
        + 'no longer closes the shape, and the final position tells you by '
        + 'how much it missed. Change it to 120. Work out from the narration '
        + 'what shape it drew.' },
    ],
  },
  {
    id: 'tutorial-line',
    title: 'Tutorial 2: Follow a line',
    example: 'follow-line',
    guided: [
      {
        keys: "You are already in the toolbox, on Start. Right arrow into its blocks, Enter to take \u201cwhen the program starts\u201d, Enter to put it down. Then T to come back to the toolbox, arrow down to Movement, right arrow in, arrow down to \u201cset driving speed to 50 percent\u201d, Enter, Enter to accept it inside. Right arrow twice to the number, Enter, type 30, Enter.",
        keysHint: "Two Enters for every block: one to take it, one to accept where it is going. The words between them tell you where that is.",
        say: 'Start with "when the program starts", and put "set driving '
          + 'speed to 30 percent" inside it.',
        hint: 'Change the speed block from 50 to 30. A line follower that '
          + 'goes too fast leaves the line before it notices.',
        done: block('spike_set_speed', {
          inside: 'spike_when_started',
          number: ['PERCENT', 30],
        }),
      },
      {
        keys: "Press T, arrow down to Control, right arrow in, arrow down to \u201crepeat while\u201d, Enter, and accept it under the speed block. Then right arrow to its dropdown, Enter, arrow to \u201cuntil\u201d, Enter.",
        keysHint: "The same block does while and until. The dropdown is the first thing inside it, so one right arrow reaches it.",
        say: 'Under the speed block, put a "repeat until" block from Control.',
        hint: 'The Control category has "repeat while" and "repeat until". '
          + 'Choose until, then set the dropdown to "until" if it is not '
          + 'already.',
        done: block('controls_whileUntil', {
          inside: 'spike_when_started',
          fields: { MODE: 'UNTIL' },
        }),
      },
      {
        keys: "Press T, arrow down to Sensors, right arrow in, arrow down to \u201ccolour sensor C sees black\u201d, Enter. It should say it is going into the repeat block\u2019s test. Accept with Enter, then right arrow to the colour dropdown, Enter, arrow to red, Enter.",
        keysHint: "The test socket is at the top of the repeat block, and it is the first place a sensor block will offer to go.",
        say: 'Its test is "colour sensor C sees red", from Sensors. That is '
          + 'what tells the robot it has arrived.',
        hint: 'Drop the sensor block into the socket at the top of the repeat '
          + 'block, and set the colour dropdown to red.',
        done: block('spike_is_color', {
          inside: 'controls_whileUntil',
          fields: { PORT: 'C', COLOUR: 'RED' },
        }),
      },
      {
        keys: "Press T, Control, right arrow in, arrow down to \u201cif\u201d, Enter, and put it inside the repeat. Open the block\u2019s own menu with Control and Enter, and choose the option that adds an else. Then add another \u201ccolour sensor C sees black\u201d into its test.",
        keysHint: "The if block grows an else through its menu. Control and Enter opens the menu for whichever block you are on.",
        say: 'Inside the loop, put an "if / else" block from Control, and '
          + 'make its test "colour sensor C sees black".',
        hint: 'Plain "if" grows an else branch through its little menu — open '
          + 'the block\u2019s menu and add "else".',
        done: both(
          block('controls_if', { inside: 'controls_whileUntil' }),
          block('spike_is_color', {
            inside: 'controls_if',
            fields: { PORT: 'C', COLOUR: 'BLACK' },
          }),
        ),
      },
      {
        keys: "Twice from Movement: \u201cstart driving with steering\u201d into the if branch, with its number set to minus 25, and another into the else branch set to 25. Type the minus sign before the digits.",
        keysHint: "If the second one keeps going into the first branch, arrow while you are placing it until it says the else branch.",
        say: 'If it sees black, "start driving with steering" set to minus '
          + '25. Otherwise, another one set to 25.',
        hint: 'Two of the same block with opposite numbers: one steers one '
          + 'way when it is on the line, the other steers back when it is not.',
        done: both(
          block('spike_move_steer', { inside: 'controls_if', number: ['STEERING', -25] }),
          block('spike_move_steer', { inside: 'controls_if', number: ['STEERING', 25] }),
        ),
      },
      {
        keys: "Press T, Control, right arrow in, arrow down to \u201cwait 1 seconds\u201d, Enter, and place it inside the loop after the if block. Right arrow to the number, Enter, type 0.1, Enter.",
        keysHint: "Without this the program never gives the robot time to move and nothing happens at all. It is the step everybody misses.",
        say: 'Still inside the loop and under the if / else, put "wait 0.1 '
          + 'seconds" from Control.',
        hint: 'Without this the program spins without ever letting the robot '
          + 'move, and nothing happens at all. This is the step everybody '
          + 'misses.',
        done: block('spike_wait_seconds', {
          inside: 'controls_whileUntil',
          number: ['SECONDS', 0.1],
        }),
      },
      {
        keys: "Two more, both after the loop rather than inside it: \u201cstop driving\u201d from Movement and \u201cprint\u201d from Sound and display. Listen for \u201cafter\u201d rather than \u201cinside\u201d before you accept either.",
        keysHint: "Press I at any time to hear where you are and what you are on.",
        say: 'After the loop, outside it, put "stop driving" and then a '
          + '"print" block.',
        hint: 'Outside the loop: these happen once, when the red square has '
          + 'been found.',
        done: both(
          block('spike_move_stop', { notInside: 'controls_whileUntil' }),
          block('spike_print', { notInside: 'controls_whileUntil' }),
        ),
      },
    ],
    body: [
      { p: 'The robot uses its colour sensor to stay on a black line, and '
        + 'stops when it reaches the red square at the end.' },
      { h: 'Set it up' },
      { steps: [
        'Set the mat to "First line".',
        'Set the robot to "Standard base".',
        'Press "Connect to simulator".',
      ] },
      { h: 'How it works before you build it' },
      { p: 'The robot cannot see the line. It can only ask "is there black '
        + 'underneath me right now". So it steers one way when it sees black '
        + 'and the other way when it does not, and the wobble between the two '
        + 'is what following a line actually is.' },
      { h: 'Build it' },
      { steps: [
        '"when the program starts", then "set driving speed to 30 percent".',
        'A "repeat until" block from Control. Its test is "colour sensor C '
          + 'sees red" from Sensors — so it keeps going until it arrives.',
        'Inside the loop, an "if / else" block. Its test is "colour sensor C '
          + 'sees black".',
        'If it sees black: "start driving with steering -25".',
        'Otherwise: "start driving with steering 25".',
        'Still inside the loop, under the if/else: "wait 0.1 seconds".',
        'After the loop: "stop driving", then a print block.',
      ] },
      { note: 'The wait is not optional. "Start driving with steering" sets '
        + 'the motors and finishes straight away, so without it the loop goes '
        + 'round for ever and never lets the robot move at all. The program '
        + 'looks frozen. This catches everybody once.' },
      { h: 'Run it' },
      { p: 'The narration says the robot is curving left, then right, then '
        + 'left — that is it finding the edge over and over. After about '
        + 'fourteen seconds the colour sensor sees red, the robot stops, and '
        + 'your message is printed.' },
      { h: 'Then make it worse, and better' },
      { p: 'Turn the steering up to 60 and run it again: it wobbles harder '
        + 'and may lose the line entirely. Turn it down to 10: it corrects '
        + 'too gently and drifts off on the first bend. Somewhere in between '
        + 'is the answer, and finding it by listening is the exercise.' },
    ],
  },
  {
    id: 'tutorial-wall',
    title: 'Tutorial 3: Stop at the wall',
    example: 'stop-at-wall',
    guided: [
      {
        keys: "You are already in the toolbox, on Start. Right arrow into its blocks, Enter, Enter to put the start block down. Then T to come back, arrow down to Movement, right arrow in, \u201cset driving speed\u201d, Enter, Enter to accept it inside. Right arrow twice to the number, Enter, type 40, Enter.",
        keysHint: "Two Enters per block: take it, then accept where it is going.",
        say: 'Start with "when the program starts", and put "set driving '
          + 'speed to 40 percent" inside it.',
        hint: 'The speed block arrives saying 50. Move onto the number and '
          + 'type 40.',
        done: block('spike_set_speed', {
          inside: 'spike_when_started',
          number: ['PERCENT', 40],
        }),
      },
      {
        keys: "Press T, Movement, right arrow in, arrow down to \u201cstart driving forward\u201d \u2014 not \u201cdrive forward for\u201d, which is a different block. Enter, then accept it under the speed block.",
        keysHint: "\u201cStart driving\u201d does not wait. \u201cDrive for\u201d does. That difference is what makes the next step possible.",
        say: 'Under it, "start driving forward" from Movement.',
        hint: 'This is the one that does not wait. It sets the motors going '
          + 'and moves straight on to the next block, which is what lets the '
          + 'next step watch while the robot drives.',
        done: block('spike_move_start', {
          inside: 'spike_when_started',
          fields: { DIRECTION: 'FORWARD' },
        }),
      },
      {
        keys: "Press T, Control, right arrow in, arrow down to \u201cwait until\u201d, Enter, and accept it under the driving block.",
        keysHint: "Wait until holds the program still while the robot keeps moving.",
        say: 'Under that, a "wait until" block from Control.',
        hint: 'Wait until is how a program holds still while the world '
          + 'changes around it.',
        done: block('spike_wait_until', { inside: 'spike_when_started' }),
      },
      {
        keys: "Press T, arrow down to Maths and logic, right arrow in, arrow down to the comparison block \u2014 it reads as a socket, an equals sign, and another socket. Enter, and accept it into the wait block. Then right arrow to the dropdown, Enter, arrow to the less-than sign, Enter.",
        keysHint: "The dropdown sits between the two sockets, so it is the second thing you reach going right.",
        say: 'Put a comparison from Maths and logic into the wait, and set '
          + 'its middle dropdown to the less-than sign.',
        hint: 'The comparison block has two sockets and a dropdown between '
          + 'them. Less than is the second choice.',
        done: block('logic_compare', {
          inside: 'spike_wait_until',
          fields: { OP: 'LT' },
        }),
      },
      {
        keys: "Press T, Sensors, right arrow in, arrow down to \u201cdistance at D in millimetres\u201d, Enter, and put it in the left socket of the comparison. Then move to the right socket and type 120 into it.",
        keysHint: "Left socket first. If it offers the right one, arrow until it says the left.",
        say: 'On the left of the comparison put "distance at D in '
          + 'millimetres" from Sensors. On the right put 120.',
        hint: '"Distance less than 120" is the robot asking whether the wall '
          + 'has got closer than twelve centimetres.',
        done: both(
          block('spike_distance', { inside: 'logic_compare', fields: { PORT: 'D' } }),
          block('logic_compare', { inside: 'spike_wait_until', number: ['B', 120] }),
        ),
      },
      {
        keys: "Last, after the wait: \u201cstop driving\u201d from Movement, then \u201cprint\u201d from Sound and display.",
        keysHint: "Both go after the wait block, not inside anything.",
        say: 'After the wait, "stop driving", and then a "print" block.',
        hint: 'These run the moment the waiting is over, which is the moment '
          + 'the wall is close.',
        done: both(
          block('spike_move_stop', { inside: 'spike_when_started' }),
          block('spike_print', { inside: 'spike_when_started' }),
        ),
      },
    ],
    body: [
      { p: 'The robot drives forward and stops before it hits something, '
        + 'using the distance sensor. This is the first program that reacts '
        + 'to the world rather than following instructions.' },
      { h: 'Set it up' },
      { steps: [
        'Set the mat to "Practice mat" — it has a wall at the end.',
        'Set the robot to "Standard base".',
        'Press "Connect to simulator".',
      ] },
      { h: 'Build it' },
      { steps: [
        '"when the program starts", then "set driving speed to 40 percent".',
        '"start driving forward" from Movement. This one does not wait — it '
          + 'starts the motors and moves straight on to the next block.',
        'A "wait until" block from Control.',
        'Its test: from Maths and logic take a comparison, put "distance at D '
          + 'in millimetres" on the left, choose "<", and put 120 on the '
          + 'right.',
        'Then "stop driving", and a print block.',
      ] },
      { h: 'Run it' },
      { p: 'The robot drives the length of the mat and stops about 12 '
        + 'centimetres short of the wall, having travelled a little under two '
        + 'metres.' },
      { h: 'Then find the edge of it' },
      { p: 'Change 120 to 40 and run it again: it stops much later, and much '
        + 'closer. Change it to 400: it stops early, a long way out. Then put '
        + 'the speed up to 90 with the distance back at 120 and see whether '
        + 'it still stops in time — a faster robot needs more warning, and '
        + 'the narration will tell you if it did not get it.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * The whole thing.
 * ------------------------------------------------------------------ */

/** Grouped, in the order somebody meets them. */
export function helpSections() {
  return [
    {
      title: 'Getting started',
      topics: [WHAT_THIS_IS, FIRST_PROGRAM, RUNNING],
    },
    {
      title: 'Tutorials',
      topics: TUTORIALS,
    },
    {
      title: 'How it all works',
      topics: [
        THE_SIMULATOR,
        blocksTopic(),
        worldTopic(),
        LISTENING,
        SAVING,
        STUCK,
      ],
    },
  ];
}

/** Every topic, flat, for looking one up by id. */
export function helpTopics() {
  return helpSections().flatMap((section) => section.topics);
}

/** The example a tutorial offers to open, if it has one. */
export function exampleFor(topicId) {
  const topic = helpTopics().find((entry) => entry.id === topicId);
  if (!topic?.example) return null;
  return EXAMPLES.find((entry) => entry.id === topic.example) ?? null;
}
