# Follow the black line until the colour sensor finds the red target square.
#
# A proportional follower: the further the reading is from the edge value,
# the harder it steers back. This is the program that most needs a simulator,
# because getting the sign of the correction wrong is invisible until the
# robot drives off the mat.
import runloop
import motor_pair
import color_sensor
import color
from hub import port

motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

EDGE = 50        # halfway between black (6) and white (94)
GAIN = 0.9
SPEED = 250


async def main():
    print("following the line")
    while color_sensor.color(port.C) != color.RED:
        error = color_sensor.reflection(port.C) - EDGE
        motor_pair.move(motor_pair.PAIR_1, int(error * GAIN), velocity=SPEED)
        await runloop.sleep_ms(20)

    motor_pair.stop(motor_pair.PAIR_1)
    print("found the red square")


runloop.run(main())
