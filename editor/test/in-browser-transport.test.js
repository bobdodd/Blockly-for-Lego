/**
 * The options actually reaching the worker.
 *
 * What went wrong: the constructor destructured the options it knew about and
 * rebuilt `this.options` from exactly those. A new option — which mat to lay
 * out — was added at the editor end and at the worker end, and dropped in
 * between. It went in, came out, and was silently the default the whole way,
 * with nothing anywhere saying so.
 *
 * The listing is deliberate; a `...rest` would take anything, including a
 * typo. The cost of that choice is that every option has to be added in three
 * places, so it is worth a test that fails when one of them is missed.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { InBrowserSimulatorTransport } from '../src/transport/in-browser.js';

/** Enough of a browser for connect() to post its first message. */
function stubBrowser() {
  const posted = [];
  const previous = {
    document: globalThis.document,
    Worker: globalThis.Worker,
  };

  globalThis.document = { baseURI: 'https://example.test/block-lego/index.html' };
  let live = null;
  globalThis.Worker = class {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      live = this;
    }

    postMessage(message) { posted.push(message); }

    terminate() {}
  };

  return {
    posted,
    /** Pretend the worker sent something back. */
    reply: (message) => live?.onmessage({ data: message }),
    restore() {
      globalThis.document = previous.document;
      globalThis.Worker = previous.Worker;
    },
  };
}

describe('options given to the transport', () => {
  it('keeps the mat, rather than dropping it on the way past', () => {
    const transport = new InBrowserSimulatorTransport({ mat: 'zigzag' });
    assert.equal(transport.options.mat, 'zigzag');
  });

  it('keeps every option it is given', () => {
    const given = {
      speed: 5,
      snapshotInterval: 0.02,
      indexURL: 'https://cdn.test/',
      mat: 'the-loop',
      robot: 'wide',
    };
    assert.deepEqual(new InBrowserSimulatorTransport(given).options, given);
  });

  it('still has sensible values when given nothing', () => {
    const transport = new InBrowserSimulatorTransport();
    assert.equal(transport.options.speed, 1);
    assert.equal(transport.options.snapshotInterval, 0.05);
    assert.equal(transport.options.mat, '', 'empty means the simulator chooses');
    assert.equal(transport.options.robot, '');
  });
});

describe('what the worker is actually told', () => {
  it('sends the chosen mat with the start message', () => {
    // The contract the last bug broke: the editor can set a mat all it likes
    // if the message that starts the simulator does not carry it.
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport({ mat: 'slalom' });
      transport.connect();

      const start = browser.posted.find((message) => message.type === 'start');
      assert.ok(start, 'the worker was never told to start');
      assert.equal(start.mat, 'slalom');
    } finally {
      browser.restore();
    }
  });

  it('sends the speed and snapshot interval too', () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport({ speed: 10, snapshotInterval: 0.01 });
      transport.connect();

      const start = browser.posted.find((message) => message.type === 'start');
      assert.equal(start.speed, 10);
      assert.equal(start.snapshotInterval, 0.01);
    } finally {
      browser.restore();
    }
  });

  it('leaves the download address out unless one was asked for', () => {
    const browser = stubBrowser();
    try {
      new InBrowserSimulatorTransport().connect();
      const start = browser.posted.find((message) => message.type === 'start');
      assert.ok(!('indexURL' in start), 'the worker has its own default');
    } finally {
      browser.restore();
    }
  });

  it('passes an empty mat through, so the simulator picks its own', () => {
    const browser = stubBrowser();
    try {
      new InBrowserSimulatorTransport().connect();
      const start = browser.posted.find((message) => message.type === 'start');
      assert.equal(start.mat, '');
    } finally {
      browser.restore();
    }
  });
});


describe('changing the mat without starting over', () => {
  it('asks the worker to swap it, rather than being torn down', async () => {
    // Python is the expensive part and the mat is the cheap one. Tearing the
    // worker down meant loading Python again every time a student tried
    // another mat, which is most of what a catalogue is for.
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport({ mat: 'practice' });
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: [] });
      await running;
      browser.posted.length = 0;

      transport.setMat('zigzag');
      const asked = browser.posted.find((message) => message.type === 'mat');
      assert.ok(asked, 'the worker was never asked to change the mat');
      assert.equal(asked.name, 'zigzag');
    } finally {
      browser.restore();
    }
  });

  it('waits for the worker to say the mat is laid out', async () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport();
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: [] });
      await running;

      const changing = transport.setMat('slalom');
      let settled = false;
      changing.then(() => { settled = true; });

      await Promise.resolve();
      assert.equal(settled, false, 'it should still be waiting');

      browser.reply({ type: 'mat-ready', mat: 'slalom' });
      assert.equal(await changing, 'slalom');
    } finally {
      browser.restore();
    }
  });

  it('reports a mat that will not load, rather than hanging', async () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport();
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: [] });
      await running;

      const changing = transport.setMat('no-such-mat');
      browser.reply({ type: 'error', message: 'There is no mat called that.' });

      await assert.rejects(changing, /no mat called/);
    } finally {
      browser.restore();
    }
  });

  it('just remembers the choice when nothing is running yet', async () => {
    const transport = new InBrowserSimulatorTransport();
    assert.equal(await transport.setMat('the-loop'), 'the-loop');
    assert.equal(transport.options.mat, 'the-loop', 'and uses it when it starts');
  });
});


describe('changing the robot', () => {
  it('asks the worker to rebuild it, keeping the mat it is on', async () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport({ mat: 'zigzag' });
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: {} });
      await running;
      browser.posted.length = 0;

      transport.setRobot('small-wheels');
      const asked = browser.posted.find((message) => message.type === 'robot');
      assert.ok(asked, 'the worker was never asked');
      assert.equal(asked.name, 'small-wheels');
      assert.equal(asked.mat, 'zigzag', 'changing the robot must not change the mat');
    } finally {
      browser.restore();
    }
  });

  it('waits for the worker to say it is built', async () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport();
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: {} });
      await running;

      const changing = transport.setRobot('narrow');
      browser.reply({ type: 'robot-ready', robot: 'narrow' });
      assert.equal(await changing, 'narrow');
    } finally {
      browser.restore();
    }
  });

  it('reports a build that will not load, rather than hanging', async () => {
    const browser = stubBrowser();
    try {
      const transport = new InBrowserSimulatorTransport();
      const running = transport.connect();
      browser.reply({ type: 'ready', catalogue: {} });
      await running;

      const changing = transport.setRobot('nope');
      browser.reply({ type: 'error', message: 'There is no robot called that.' });
      await assert.rejects(changing, /no robot called/);
    } finally {
      browser.restore();
    }
  });
});
