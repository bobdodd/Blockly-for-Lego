/**
 * The standalone robot view.
 *
 * Connects to the simulator as an *observer* — a second client on the same
 * socket that never sends a program — and hands its messages to a RobotView.
 * The editor mounts the same component over its own connection; this page
 * exists so the robot can go on a projector or a second screen while a
 * student keeps the editor full size.
 *
 * The narration panel is not decoration. It carries the same sentences a
 * blind student hears, next to the picture, so a coach demonstrating to a
 * class has both in front of them and the two stay tied together.
 */

import { SimulatorTransport } from '../transport/websocket.js';
import { RobotView } from './robot-view.js';
import robotDescription from './driving-base.json' with { type: 'json' };

const element = (id) => document.getElementById(id);

const ui = {
  canvas: element('scene'),
  status: element('viewer-status'),
  narration: element('narration'),
  focusLabel: element('focus-label'),
  follow: element('follow-robot'),
  reset: element('reset-view'),
  pose: element('pose'),
};

const view = new RobotView(ui.canvas, robotDescription, {
  onStatus: (message) => { ui.status.textContent = message; },
  onPose: (text) => { ui.pose.textContent = text; },
  onFocus: (label) => { ui.focusLabel.textContent = label ? `Showing: ${label}` : ''; },
});

const MAX_NARRATION = 120;

function addNarration(payload) {
  const entry = document.createElement('li');
  entry.className = `narration-entry narration-${payload.kind}`;
  entry.textContent = payload.message;
  ui.narration.append(entry);
  while (ui.narration.children.length > MAX_NARRATION) {
    ui.narration.firstElementChild.remove();
  }
  ui.narration.scrollTop = ui.narration.scrollHeight;
}

async function connect() {
  const base = new URLSearchParams(location.search).get('simulator')
    ?? 'ws://127.0.0.1:8765';
  // the flag rides on the handshake, so the simulator knows what we are
  // before it decides whether to announce us
  const url = base.includes('?') ? `${base}&observe=1` : `${base}/?observe=1`;
  const transport = new SimulatorTransport(url);

  transport.onNarration = (payload) => {
    view.handleMessage(payload);
    if (payload.type === 'event') addNarration(payload);
  };
  transport.onClose = () => {
    ui.status.textContent = 'The simulator disconnected. Start it again and reload this page.';
    view.clear();
  };

  ui.status.textContent = `Connecting to the simulator at ${base}…`;
  try {
    await transport.connect();
  } catch (error) {
    ui.status.textContent =
      `${error.message} This page only watches — it needs the simulator running.`;
    return;
  }
  ui.status.textContent = 'Watching the simulated robot.';
}

ui.follow.addEventListener('change', (event) => { view.follow = event.target.checked; });
ui.reset.addEventListener('click', () => view.resetView());

view.start();
connect();
