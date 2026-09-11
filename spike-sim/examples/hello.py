# The smallest useful program: say something, and show something.
import runloop
from hub import light_matrix, sound

print("Hello from the hub!")


async def main():
    await light_matrix.write("Hi")
    await sound.beep(440, 300)


runloop.run(main())
