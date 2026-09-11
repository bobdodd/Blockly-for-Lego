"""
Command line entry point.

    python -m spike_sim                    serve a hub on ws://127.0.0.1:8765
    python -m spike_sim --run program.py   run one program and print what happened

The second form is the one to reach for while writing a code generator: it
needs no client, no browser and no hardware, and it prints the narration --
which is the same text a student will hear.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from . import events as ev
from .hub import HubSimulator
from .robot import Robot, RobotConfig
from .server import SimulatorServer
from .world import World, default_world

KIND_PREFIX = {
    ev.CONSOLE: "  print",
    ev.ERROR: "  ERROR",
    ev.PROGRAM: "program",
    ev.MOTOR: "  motor",
    ev.DRIVE: "  drive",
    ev.SENSOR: " sensor",
    ev.DISPLAY: "display",
    ev.SOUND: "  sound",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="spike_sim",
        description="A LEGO Education SPIKE Prime hub simulator that speaks the real protocol.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="address to serve on")
    parser.add_argument("--port", type=int, default=8765, help="port to serve on")
    parser.add_argument(
        "--speed", type=float, default=1.0,
        help="simulated seconds per real second (default 1.0)",
    )
    parser.add_argument("--world", help="path to a world JSON file")
    parser.add_argument(
        "--noise", type=float, default=0.0,
        help="wheel slip, e.g. 0.02 for 2%% scatter (default 0, perfectly repeatable)",
    )
    parser.add_argument("--run", metavar="FILE", help="run one program, print the narration, exit")
    parser.add_argument("--json", action="store_true", help="print events as JSON lines")
    parser.add_argument("--quiet", action="store_true", help="do not print the narration")
    parser.add_argument(
        "--wheel-diameter", type=float, default=56.0, help="wheel diameter in mm (default 56)"
    )
    parser.add_argument(
        "--axle-track", type=float, default=112.0,
        help="distance between the drive wheels in mm (default 112)",
    )
    return parser


def make_hub(args) -> HubSimulator:
    world = World.load(args.world) if args.world else default_world()
    config = RobotConfig(
        noise=args.noise,
        wheel_diameter_mm=args.wheel_diameter,
        axle_track_mm=args.axle_track,
    )
    robot = Robot(config=config, world=world)
    return HubSimulator(robot, speed=args.speed)


def attach_printer(hub: HubSimulator, args) -> None:
    if args.quiet:
        return

    def on_event(event: ev.Event) -> None:
        if args.json:
            print(json.dumps({
                "time": round(event.sim_time, 3),
                "kind": event.kind,
                "message": event.message,
                "data": event.data,
            }), flush=True)
        else:
            prefix = KIND_PREFIX.get(event.kind, event.kind)
            print(f"[{event.sim_time:7.2f}s] {prefix} | {event.message}", flush=True)

    hub.log.subscribe(on_event)


async def run_one(args) -> int:
    hub = make_hub(args)
    attach_printer(hub, args)

    try:
        source = open(args.run, encoding="utf8").read()
    except OSError as error:
        print(f"Could not read {args.run}: {error}", file=sys.stderr)
        return 2

    await hub.start()
    await hub.load_and_run(source)
    try:
        await hub.wait_for_program(timeout=120)
    except TimeoutError as error:
        print(f"\n{error}", file=sys.stderr)
        await hub.stop()
        return 1
    await hub.stop()

    if not args.quiet and not args.json:
        print()
        print(hub.robot.describe_position())
        print(f"It travelled {ev.say_distance(hub.robot.odometer_mm)} in total.")

    failed = any(e.kind == ev.ERROR for e in hub.log.events)
    return 1 if failed else 0


async def serve(args) -> int:
    hub = make_hub(args)
    attach_printer(hub, args)
    server = SimulatorServer(hub, host=args.host, port=args.port)

    if not args.quiet:
        print(f"SPIKE hub simulator listening on ws://{args.host}:{args.port}")
        print(f"  browser editor : connect a WebSocket, send COBS frames as binary messages")
        print(f"  python client  : open a plain TCP socket to {args.host}:{args.port}")
        print(f"  simulated speed: {args.speed}x")
        print("Press Ctrl+C to stop.\n")

    try:
        await server.serve_forever()
    except asyncio.CancelledError:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    coroutine = run_one(args) if args.run else serve(args)
    try:
        return asyncio.run(coroutine)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
