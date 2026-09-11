/**
 * Converting between LDraw's frame and the simulator's.
 *
 * Kept here, free of three.js, because getting it wrong is silent. Nothing
 * throws; the robot simply comes out in pieces, and the mistake looks like a
 * rendering problem rather than an arithmetic one.
 *
 * Two separate things are easy to confuse, and confusing them is exactly what
 * went wrong the first time:
 *
 *  - **Geometry inside a part file** is in LDraw units and must be scaled by
 *    {@link LDU_MM} to become millimetres.
 *  - **Where a part is placed** is already written in millimetres in the robot
 *    description, and must NOT be scaled again. Scaling it spreads the robot
 *    out by 1/0.4 = two and a half times, with every part still the right size
 *    individually — which looks like a viewport bug and is not one.
 *
 * Axes differ too. LDraw is +x right, +y DOWN, +z forward. The simulator is
 * +x forward, +y left, +z up.
 */

/** One LDraw unit, in millimetres. */
export const LDU_MM = 0.4;

/**
 * Rows of the rotation taking an LDraw direction to a simulator direction.
 * Written out so the matrix used for rendering and the arithmetic used in
 * tests come from one place.
 */
export const LDRAW_TO_ROBOT_ROWS = [
  [0, 0, 1], //  x_robot =  z_ldraw   LDraw forward is our forward
  [-1, 0, 0], // y_robot = -x_ldraw   LDraw right is our negative left
  [0, -1, 0], // z_robot = -y_ldraw   LDraw's Y points down; ours points up
];

/**
 * Convert a point from LDraw axes to the robot's own frame.
 * Units pass through unchanged: millimetres in, millimetres out.
 *
 * @param {[number, number, number]} point in LDraw axes
 * @returns {[number, number, number]} in the simulator's axes
 */
export function ldrawToRobot([x, y, z]) {
  return LDRAW_TO_ROBOT_ROWS.map(
    ([a, b, c]) => a * x + b * y + c * z,
  );
}

/** Convert LDraw units to millimetres. For geometry, never for placement. */
export const lduToMm = (units) => units * LDU_MM;
