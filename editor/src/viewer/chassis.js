/**
 * Redrawing the robot for a different build.
 *
 * The catalogue offers the same chassis with the wheels closer together or
 * further apart, and larger or smaller. Those two measurements are what turn
 * motor degrees into millimetres, so the simulator behaves differently for
 * each — and a 3D view that drew the same picture regardless would be showing
 * a robot that is not the one running. That is the exact failure this project
 * keeps guarding against: a sighted student and a blind student looking at two
 * different robots.
 *
 * Pure functions over the description, with no three.js in sight, so the
 * arithmetic can be tested without a renderer.
 *
 * ## Moving, not stretching
 *
 * A wider base is not a stretched one. A motor is a fixed-size lump of
 * plastic; you widen a base by putting beams between the motors, which moves
 * everything outboard of them by the same amount and changes nothing about
 * their size or their spacing from the wheels. So every off-centre piece
 * shifts by the same distance, rather than having its position scaled — which
 * would slowly slide the wheels into the motors and look like a rendering
 * bug.
 */

/** Pieces at the mat's centreline do not move when the track changes. */
const ON_THE_AXIS = 0.5;

/**
 * A description redrawn for a particular build.
 *
 * @param {object} description the robot as written down, at its own measurements
 * @param {{wheelDiameterMm?: number, axleTrackMm?: number}} chassis what to draw
 * @returns {object} a new description; the original is not touched
 */
export function reshape(description, chassis = {}) {
  if (!description?.pieces) return description;

  const baseTrack = Number(description.axleTrackMm) || 0;
  const baseWheel = Number(description.wheelDiameterMm) || 0;
  const track = Number(chassis.axleTrackMm) || baseTrack;
  const wheel = Number(chassis.wheelDiameterMm) || baseWheel;

  if (!baseTrack || !baseWheel) return description;
  if (track === baseTrack && wheel === baseWheel) return description;

  // Half the change, because the track widens on both sides at once.
  const shift = (track - baseTrack) / 2;
  const wheelScale = wheel / baseWheel;

  return {
    ...description,
    wheelDiameterMm: wheel,
    axleTrackMm: track,
    pieces: description.pieces.map((piece) => {
      const [x, y, z] = piece.position;
      const outward = Math.abs(x) > ON_THE_AXIS ? Math.sign(x) * shift : 0;
      const moved = { ...piece, position: [x + outward, y, z] };

      // The diameter is the measurement that decides how far a rotation
      // takes the robot, so it is the one the picture has to get right. The
      // width comes along with it, which makes a small wheel a scaled large
      // one rather than the narrower part it really is — a stand-in, and the
      // honest half of it is the half that matters.
      if (piece.role === 'wheel' && wheelScale !== 1) moved.scale = wheelScale;
      return moved;
    }),
  };
}

/**
 * Whether two builds are the same one.
 *
 * Used to decide whether a newly connected simulator needs the model rebuilt,
 * which means loading LDraw parts again — worth avoiding when nothing changed.
 */
export function sameChassis(a, b) {
  if (!a || !b) return false;
  return Number(a.wheelDiameterMm) === Number(b.wheelDiameterMm)
    && Number(a.axleTrackMm) === Number(b.axleTrackMm);
}
