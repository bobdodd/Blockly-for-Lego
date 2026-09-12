# Contributing

Contributions are welcome, and especially welcome from people who use screen
readers, braille displays or switch access. If you are a blind developer or
educator and something here is wrong, please open an issue — being told is more
useful than being guessed about.

## The one non-negotiable

**Any user-facing change must be operable by keyboard alone, and tested with a
screen reader before it is merged.** Not "should be accessible". Tested.

For editor work, that means at least one of NVDA, JAWS or VoiceOver, and a note
in the pull request saying which you used and what you tried. For simulator
work, it means reading the narration the change produces and asking whether a
sentence spoken aloud would actually tell a student what happened.

A change that is accessible in principle but has never been listened to is not
finished.

## Writing narration

`spike-sim/spike_sim/events.py` is the place to understand first. Event
messages are the simulator's primary output, not a debug log.

- Write full sentences meant to be spoken verbatim.
- Say units out loud: "25 centimetres", not "250mm".
- Never emit coordinate dumps as the message. Machine-readable values belong
  in the event's `data` dict.
- Watch repetition. A proportional line-follower calls `move()` every 20ms; a
  naive implementation produced 650 identical sentences in one run. Repeated
  commands should become periodic progress reports.
- Keep readings coherent. Deriving colour and reflectance separately once
  produced "white, reflecting 10 percent" — physically impossible, and
  impossible to narrate.

## Simulator changes

Run the tests:

```bash
cd spike-sim
python3 -m pytest tests/ -q
```

A few rules specific to this codebase:

- **Never modify `spike_sim/vendor/`.** Those files are LEGO's, vendored
  unmodified so the wire format cannot drift. The hub-side mirror is
  `spike_sim/wire.py`.
- **Do not add a silent stub.** An unmodelled API must raise
  `NotImplementedError` naming the call. A stub that returns a plausible
  default lets a block generate code that passes here and fails on hardware,
  which is the one failure this project exists to prevent.
- **Prefer predictable physics.** `run_for_degrees(90)` turns exactly 90
  degrees. Realism that makes a student doubt a correct program is a
  regression, not a feature. Realism belongs behind `--noise`.
- New behaviour needs a test. The physics tests found three real bugs during
  the initial build, including one where driving a negative distance never
  terminated.

## Editor changes

- **Never rename or remove a block type.** Students' saved programs name the
  block types they use, and Blockly's loader fails on one it does not
  recognise — so a rename silently breaks every file already saved. Add a new
  type and leave the old one loadable.

- **Show and hide with the `hidden` property, never with `display`.** And if
  you add a rule that sets `display`, check it cannot apply to something that
  gets hidden. `hidden` takes its `display: none` from the browser's
  stylesheet, so any author rule beats it — a single
  `.tab-panel { display: flex }` once un-hid every tab panel in the editor.
  That is not just a layout bug: a panel still rendered is still in the
  accessibility tree, so a screen reader announces content the tab says is
  not showing, and `aria-selected` becomes a lie. `test/stylesheet.test.js`
  guards it.
- **Wheel diameter and axle track reach three places.** The simulator's
  physics, the 3D model, and the constants baked into the Python a student's
  blocks generate. They agreed by hand when there was one robot. Now they all
  read from `spike_sim/robots/*.json`, and `test_robots.py` checks it — if you
  add a measurement that matters, add it there rather than typing it out
  again. The 3D view takes them from the `hello` payload rather than from the
  editor's menu, so a simulator started elsewhere is still drawn correctly.

- **Only one window may speak.** Both windows get the same telemetry and both
  have a speaker, so anything that talks has to go through the baton in
  `viewer/baton.js`: the window with focus speaks and the others stand down.
  Doubling the audio does not read as a bug, it reads as the program having
  run twice. Yielding silences the sound and the live region, never the
  visible transcript — that is per-screen and not a duplication.

- **Two pages mount the same controls; wire both.** The editor and the
  pop-out both call `mountCommentaryControls`, and the pop-out once quietly
  had three fewer arguments than the editor — the voice picker, the channel
  read-out and the test button were in its markup, connected to nothing.
  Nothing failed and nothing said so; they simply did not work.
  `app-wiring.test.js` now compares the two argument lists.

- **A second window cannot reach the built-in simulator.** It runs in a
  worker the editor's window owns. Anything else that wants its messages —
  the pop-out robot view, and anything like it — has them repeated over
  `viewer/relay.js` rather than connecting itself. When the only simulator was
  one you started, every viewer was a socket client, and that assumption
  outlived the thing that made it true.

- **A change you can only see is half a change.** The robot catalogue redraws
  the 3D view, which is no use at all to the student this editor exists for.
  Anything that alters what the robot *is* has to reach the spoken description
  too — the build is now a sentence in it, so picking another robot is
  something you hear. Ask of any new feature: what does this sound like?

- **Only offer robots somebody could build.** A 112mm axle track was described
  here once and was physically impossible: two large angular motors facing
  outwards need 60mm of body each plus a 12mm shaft. A simulator will pretend
  about that indefinitely, and a club will find out with a bag of parts and an
  afternoon gone. `SMALLEST_TRACK_MM` is the floor and it is tested.

- **Whoever sets the busy state clears it.** `connectSimulator` puts the page
  into its working state and clears it in a `finally`. Anything that calls
  `startSimulator` directly skips that, and the page sits on "Starting the
  robot." with the connect buttons disabled — indistinguishable from a hang,
  and it looked exactly like one. Either go through the function that owns the
  state, or do not touch it at all.

- **An option added at both ends is not added.** The in-browser transport
  lists its options one by one rather than spreading a `...rest`, which is
  right — a rest would swallow a typo — but it means every new option has to
  be added in *three* places: where it is set, where it is forwarded, and
  where it is read. `mat` was added at two of them, so every simulator ran the
  default mat and nothing anywhere said otherwise.
  `test/in-browser-transport.test.js` now pins the forwarding.

- **Do not test a private field from outside.** `client.transport` is
  `undefined` because `HubClient` holds it in `#transport`, so
  `!(client.transport instanceof X)` is permanently true and the branch
  depending on it permanently wrong. If only one module knows a fact, keep
  the fact in that module rather than trying to read it back off an object
  that deliberately hid it.

- **Never answer only through the status region.** It is `visually-hidden`,
  so anything said only there is said only to a screen reader. A button whose
  entire response is a hidden announcement is indistinguishable, to everyone
  else, from a button with no code behind it — that is exactly how "Connect to
  a hub" came to look broken. A `title` tooltip does not count as the visible
  half: it needs a mouse. And never `return` silently from a control a person
  just pressed; say why. `test/connect-feedback.test.js` guards both.

- **Taking a control away means taking it out of the accessibility tree too.**
  Not just `display: none` on the button. A tab that has vanished visually but
  is still reachable with an arrow key, or still announced as a tab, is a
  defect only a screen reader or a keyboard finds — which is to say, only the
  students this editor exists for. `tabs.setAvailable()` hides the button,
  hides the panel, drops it from the arrow-key cycle, and moves focus off it
  if it had focus; `test/tabs.test.js` pins all four.

- **Never remove a focus outline** without replacing it with something at
  least as visible. A keyboard user who cannot see where focus is cannot use
  the editor at all.

- **Describe the scene, never the picture.** Anything that says what the 3D
  view shows takes its facts from the telemetry and the mat, not from the
  rendered canvas. The exact numbers are already known twenty times a second;
  reading them back off pixels would mean estimating values we never lost,
  and would let the description drift from what the simulator actually did.
  `src/viewer/scene-description.js` is pure functions over plain data for
  exactly this reason — no three.js, no DOM, all of it testable.

- **When the platform reports success and the user reports silence, believe
  the user.** Chrome blocking Autoplay for a site mutes `speechSynthesis`
  while reporting `speaking: true`, `paused: false`, no error and two hundred
  voices — there is nothing readable that distinguishes it from working. Four
  rounds went into "fixing" the engine before anybody simply listened. So:
  ask for the engine's state before theorising, and where a fault is outside
  the page's reach, have the interface *ask* rather than assert. "Test the
  voice" says "if you heard nothing, here is the setting" instead of "the
  voice is working", because the page cannot know which is true.

- **Test the browser, do not predict it.** Whether speech works is settled by
  trying it and waiting for `onstart`, never by inspecting `getVoices()` or
  sniffing a user agent. Safari fills the voice list synchronously and Chrome
  does not, so the predicting version read one engine as working and the other
  as broken before either had been asked to say a word — Chrome was mute for a
  whole release because of it. The same rule caught the de-Googled-Android
  case that the guess was written for in the first place.

- **Prefer cancellable speech to a live region for anything that changes
  fast.** A polite live region queues: by the time a queued sentence is read,
  the robot has moved and the sentence is wrong. `speechSynthesis` can be
  cancelled, so the latest announcement replaces the last. Keep the live
  region as the fallback — some browsers ship a speech engine with no voices,
  which reports success and makes no sound, so check for an actual voice
  rather than for the engine. See `src/viewer/speaker.js`.

- **Anything spoken is also written down.** Every announcement is mirrored to
  a visible transcript. Deaf and hard-of-hearing students need it, a noisy
  club room needs it, and it is the only way a coach can quote what a student
  was told.

- **Describe from the mat, not from the robot.** The robot is "it", not
  "you"; positions are given from the mat's nearer edges; directions are
  compass points. Speaking as though the listener were the robot puts a
  student inside a machine they are trying to look at, and it breaks down the
  moment they talk to the classmate beside them, who is outside it — two
  students discussing one robot need one frame, and it has to be the mat. The
  compass only works because the mat has a north arrow printed on it; if you
  build a mat without one, do not write narration that leans on compass
  directions. Robot-relative wording is right in exactly two places: what the
  distance sensor sees, and beats that read a student's own blocks back to
  them.

- **Announce a behaviour as it starts, not when it finishes.** A student
  listening needs to know what is happening now. Narrating a move on
  completion is several seconds of silence followed by news about the past,
  which is the failure this narration exists to prevent. The intent is always
  known up front — the call said how far to go — so say that, and let the
  events for bumping, leaving the line and the end-of-run summary report
  anything that did not go to plan.

- **Match the register to the moment.** A student who *asks* what is going on
  has stopped to listen, and should get the full description. A student
  watching their program run has not, and needs two or three words a beat —
  the robot does not pause while a sentence is read, so a long one ends after
  the thing it describes. Distances anywhere spoken get two significant
  figures: "20 centimetres", never "19.6 centimetres", which is longer to hear
  and says nothing more.

- **Narrate from `data`, never from `message`.** An event's prose is written
  to be read and will be rewritten whenever a better sentence turns up; its
  `data` is the contract. If something a client needs is not in `data`, add it
  there rather than parsing the English — that is why `phase`, `reversing` and
  `bumped` exist.

- **Do not say what you have just said.** Composed descriptions go through
  `RecentlySaid`, which drops any sentence repeated unchanged inside about
  twenty-five seconds. Keyed on the sentence itself, deliberately: "has
  anything changed" and "would I be repeating myself" are the same question,
  so one rule covers pressing Run after connecting, pressing Run after a
  summary, and every case nobody has thought of yet. If you add a new
  announcement, give it facts with a `kind` and let it through the same
  filter, rather than writing a fresh special case. Two things opt out: the
  beats during a run, because the same beat twice means it happened twice; and
  anything the student explicitly asked for.

- **Watch the antecedents when facts can be dropped.** Most of these sentences
  call the robot "it", which only works because the sentence before named it.
  When filtering removes that one, whatever ends up first has to say what it
  is talking about — `joinFacts` does this, so compose through it.

- **Stale is worse than missing.** When a description cannot be delivered
  promptly, drop it rather than queue it — and say so if the count matters.
  This is the same rule at three levels: the simulator's rate-limited
  narration, the speaker's cancel-then-speak, and the commentary dropping
  routine progress reports while something is still being said.

## Dependencies

The simulator has none, deliberately — a robotics club should be able to run it
with nothing but a Python install. Please keep it that way unless there is a
strong reason not to.

## Licence

By contributing you agree your work is licensed under Apache 2.0, matching the
project.
