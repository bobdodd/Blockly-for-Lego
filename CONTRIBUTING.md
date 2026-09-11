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

## Dependencies

The simulator has none, deliberately — a robotics club should be able to run it
with nothing but a Python install. Please keep it that way unless there is a
strong reason not to.

## Licence

By contributing you agree your work is licensed under Apache 2.0, matching the
project.
