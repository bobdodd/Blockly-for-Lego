"""
A LEGO(R) Education SPIKE(TM) Prime hub simulator.

Speaks the real hub protocol -- the one LEGO publishes at
https://lego.github.io/spike-prime-docs/ -- so a client cannot tell it apart
from hardware at the wire level, and runs the MicroPython it is sent against
a simulated driving base on a mat.

Part of the Blockly for Lego project: the simulator's primary output is a
narrated event log meant to be read aloud, not a picture of a robot.
"""

__version__ = "0.1.0"

from .robot import Robot, RobotConfig
from .world import World, default_world

__all__ = ["Robot", "RobotConfig", "World", "default_world", "__version__"]
