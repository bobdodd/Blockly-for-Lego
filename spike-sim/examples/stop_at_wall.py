# Drive forward until the distance sensor sees something close, then stop.
import runloop
import motor_pair
import distance_sensor
from hub import port

motor_pair.pair(motor_pair.PAIR_1, port.A, port.B)

STOP_AT_MM = 150


async def main():
    motor_pair.move(motor_pair.PAIR_1, 0, velocity=400)
    while True:
        away = distance_sensor.distance(port.D)
        if 0 <= away <= STOP_AT_MM:
            break
        await runloop.sleep_ms(20)
    motor_pair.stop(motor_pair.PAIR_1)
    print("stopped", away, "mm from the wall")


runloop.run(main())
