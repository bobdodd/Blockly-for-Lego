# Drive a square. The classic "did my turns work?" program.
#
# On a 56mm wheel with a 112mm axle track, 180 wheel degrees is a 90 degree
# turn, and 360 wheel degrees drives one wheel circumference: 176mm.
import runloop
import motor_pair
from hub import port

motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

SIDE_DEGREES = 720      # about 35cm
TURN_DEGREES = 180      # 90 degrees on the spot
TURN_STEERING = -100    # turn left, which keeps the square on the mat


async def main():
    for side in range(4):
        print("side", side + 1)
        await motor_pair.move_for_degrees(motor_pair.PAIR_1, SIDE_DEGREES, 0, velocity=500)
        await motor_pair.move_for_degrees(motor_pair.PAIR_1, TURN_DEGREES, TURN_STEERING, velocity=300)
    print("back where we started")


runloop.run(main())
