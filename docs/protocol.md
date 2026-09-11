# Talking to a SPIKE Prime hub

Everything this project knows about getting bytes to and from a LEGO®
Education SPIKE™ Prime hub: the protocol itself, the traps in it, and the
client we built on top.

**None of this is reverse engineered.** The LEGO Group publishes the protocol
at <https://lego.github.io/spike-prime-docs/>, under Apache 2.0, with a
working reference client. This document records what we implemented, what we
learned implementing it, and where our code sits — it is not a replacement
for LEGO's specification, which remains the authority.

---

## The shape of it

A hub is a byte pipe. You open it, send framed messages, and get framed
messages back. There is no HTTP, no JSON, no handshake beyond one exchange.

```
                  ┌──────────────────────────────────┐
   your code ───► │ message  →  COBS frame  →  packets│ ───► hub
                  └──────────────────────────────────┘
```

Programs are **plain MicroPython source**, uploaded into one of the hub's
twenty slots and started by number. The hub sends back whatever the program
prints, plus a periodic dump of every sensor and motor.

---

## Two transports, identical bytes

| | How you open it | Where it works |
| --- | --- | --- |
| **Bluetooth Low Energy** | Web Bluetooth, or any BLE library | Chrome/Edge on desktop; not Safari, Firefox, iOS |
| **USB serial** | Web Serial, 115200 baud | Same browsers |

**BLE identifiers**, from LEGO's documentation:

| | |
| --- | --- |
| Service | `0000FD02-0000-1000-8000-00805F9B34FB` |
| RX characteristic — the hub **receives** here | `0000FD02-0001-1000-8000-00805F9B34FB` |
| TX characteristic — the hub **transmits** here | `0000FD02-0002-1000-8000-00805F9B34FB` |

The hub advertises the service UUID, so you can filter scans on it. The
service is **not** on the [W3C Web Bluetooth blocklist](https://github.com/WebBluetoothCG/registries),
so browsers will grant access.

For USB, LEGO's vendor ID is **1684** (`0x0694`) at 115200 baud.

The framing and messages below are the same on both. Our client treats the
transport as a pipe with `connect`, `send`, `disconnect` and an `onData`
callback, which is why the simulator and a real hub are interchangeable.

---

## Framing: COBS

Messages are wrapped in [Consistent Overhead Byte Stuffing](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing)
so that a single reserved byte can mark the end of a frame.

| Constant | Value | Meaning |
| --- | --- | --- |
| Delimiter | `0x02` | ends a frame; never appears inside one |
| No-delimiter code | `0xFF` | block contains no delimiter byte |
| Code offset | `2` | added to every code word |
| Maximum block | `84` | bytes per block, including the code word |
| XOR mask | `3` | applied to the whole frame before sending |

This is not textbook COBS. Two deviations matter:

- **The delimiter is `0x02`, not `0x00`.** Code words encode both the block
  length and which low byte (`0x00`, `0x01` or `0x02`) ended the block.
- **The encoded frame is XORed with `3`** before the delimiter is appended.
  That keeps a literal `0x03` — ctrl-C — out of the stream, which would
  otherwise interrupt the MicroPython REPL underneath.

A received frame may begin with a `0x01` priority byte. It is unused; skip it.

Do not write your own. LEGO ship `cobs.py`, we vendor it unmodified in
[`spike-sim/spike_sim/vendor/`](../spike-sim/spike_sim/vendor/), and our
JavaScript port in [`editor/src/protocol/cobs.js`](../editor/src/protocol/cobs.js)
is tested against vectors generated from it.

---

## Checksums: CRC-32, with a trap

File uploads are protected by CRC-32. LEGO's `crc(data, seed=0, align=4)`
does two things a standard CRC-32 does not:

1. **It takes a seed**, so a running checksum can be chained across chunks.
2. **It zero-pads the data to a 4-byte boundary before hashing.**

The padding is the trap. Chaining a per-chunk CRC only arrives at the CRC of
the whole file if **every chunk except the last is a multiple of 4 bytes**.
Pick your own chunk size of, say, 100 bytes and the hub will reject your
upload with no useful explanation.

Honour the `max_chunk_size` the hub tells you and you are fine — but if you
are tempted to use something smaller, keep it 4-aligned. Our
[`crc32.js` tests](../editor/test/protocol.test.js) pin both the working case
and the broken one, so the trap stays documented in code.

---

## Messages

Every message begins with a one-byte id. Multi-byte fields are **little
endian**. Struct strings below are Python `struct` format, and are exactly
what the implementations use.

### Client → hub

| Id | Message | Layout | Fields |
| --- | --- | --- | --- |
| `0x00` | InfoRequest | `<B` | just the id |
| `0x0C` | StartFileUploadRequest | `<B{n+1}sBI` | id, NUL-terminated name (≤31 bytes encoded), slot, CRC-32 of the whole file |
| `0x10` | TransferChunkRequest | `<BIH{n}s` | id, running CRC, byte count, payload |
| `0x1E` | ProgramFlowRequest | `<BBB` | id, stop (0 = start, 1 = stop), slot |
| `0x28` | DeviceNotificationRequest | `<BH` | id, interval in milliseconds |
| `0x46` | ClearSlotRequest | `<BB` | id, slot |

### Hub → client

| Id | Message | Size | Fields |
| --- | --- | --- | --- |
| `0x01` | InfoResponse | 17 | see below |
| `0x0D` | StartFileUploadResponse | 2 | id, status |
| `0x11` | TransferChunkResponse | 2 | id, status |
| `0x1F` | ProgramFlowResponse | 2 | id, status |
| `0x20` | ProgramFlowNotification | 2 | id, stopped (0 = started, 1 = stopped) |
| `0x21` | ConsoleNotification | varies | id, then UTF-8 text, NUL padded |
| `0x29` | DeviceNotificationResponse | 2 | id, status |
| `0x3C` | DeviceNotification | varies | id, payload length, then entries |
| `0x47` | ClearSlotResponse | 2 | id, status |

**Status is `0x00` for success.** Anything else is a failure. A common and
harmless one: clearing a slot that was already empty reports failure, and
LEGO's own client ignores it.

**InfoResponse**, `<BBBHBBHHHHH`:

```
id, rpc_major, rpc_minor, rpc_build,
    firmware_major, firmware_minor, firmware_build,
    max_packet_size, max_message_size, max_chunk_size,
    product_group_device
```

The three sizes are not advisory:

- `max_packet_size` — split each frame into writes no larger than this.
- `max_chunk_size` — the largest file chunk the hub will accept.
- `max_message_size` — the largest single message.

Our simulator advertises 244 / 1024 / 512, which are plausible values for a
real hub. **Always read them from the response** rather than assuming.

### Device notifications

A `DeviceNotification` carries concatenated entries, each with its own id and
fixed size. Walk them in order; if you meet an id you do not know, **stop**
rather than guess, because a misaligned read produces plausible garbage for
everything after it.

| Id | Entry | Size | Layout | Fields |
| --- | --- | --- | --- | --- |
| `0x00` | Battery | 2 | `<BB` | id, percent |
| `0x01` | IMU | 21 | `<BBBhhhhhhhhh` | id, face up, yaw face, yaw, pitch, roll, accel x/y/z, gyro x/y/z |
| `0x02` | 5×5 display | 26 | `<B25B` | id, 25 pixel brightnesses |
| `0x0A` | Motor | 12 | `<BBBhhbi` | id, port, device type, absolute position, power, speed, position |
| `0x0B` | Force sensor | 4 | `<BBBB` | id, port, force, pressed |
| `0x0C` | Colour sensor | 9 | `<BBbHHH` | id, port, colour, red, green, blue |
| `0x0D` | Distance sensor | 4 | `<BBh` | id, port, distance in mm |
| `0x0E` | 3×3 matrix | 11 | `<BB9B` | id, port, 9 pixel values |

Two fields are **signed** and must be read as such: colour and distance both
use `-1` to mean "nothing detected". Read them unsigned and you get 255 or
65535 — a sensor that appears to see something 65 metres away.

IMU angles are in **decidegrees**: 900 means 90.0°.

Colour ids are LEGO's: 0 black, 1 magenta, 2 purple, 3 blue, 4 azure,
5 turquoise, 6 green, 7 yellow, 8 orange, 9 red, 10 white, −1 unknown.

---

## The conversation

### Connect

```
client                                   hub
  │  InfoRequest  0x00                    │
  │ ────────────────────────────────────► │
  │                    InfoResponse 0x01  │
  │ ◄──────────────────────────────────── │
```

Send `InfoRequest` **first, before anything else**. Everything after depends
on the sizes it returns.

Then subscribe to telemetry, if you want it:

```
  │  DeviceNotificationRequest 0x28, 200ms │
  │ ─────────────────────────────────────► │
  │             DeviceNotificationResponse │
  │ ◄───────────────────────────────────── │
```

### Upload and run a program

```
  ClearSlotRequest        0x46  slot            (failure here is fine)
  StartFileUploadRequest  0x0C  name, slot, crc(whole file)
  TransferChunkRequest    0x10  running_crc, chunk      ┐ repeat until
  TransferChunkRequest    0x10  running_crc, chunk      ┘ the file is sent
  ProgramFlowRequest      0x1E  stop=0, slot
```

The running CRC is chained: `running = crc(chunk, running)` for each chunk in
turn. The final value equals the CRC you declared in `StartFileUploadRequest`.

Once running, the hub sends `ProgramFlowNotification` with stopped=0, then
`ConsoleNotification` for anything the program prints, then
`ProgramFlowNotification` with stopped=1 when it ends.

To stop it early, send `ProgramFlowRequest` with stop=1.

### What a program looks like

Plain MicroPython, using the same API LEGO documents for the SPIKE app's
Python mode:

```python
import runloop
from hub import light_matrix

print("Console message from hub.")

async def main():
    await light_matrix.write("Hello, world!")

runloop.run(main())
```

`print()` comes back as `ConsoleNotification`. That is the only channel a
program has for talking to the app — and in this project it is how a student's
program talks to the student.

---

## Traps, collected

Every one of these cost us time.

**Read the InfoResponse sizes.** They govern chunking and packet splitting.

**Keep chunks 4-byte aligned**, or the chained CRC will not match.

**Buffer your reads.** A frame can arrive split across several reads, and
several frames can arrive in one. LEGO's example client skips this and says
so; anything real must not. Split on the `0x02` delimiter.

**Colour and distance are signed.** `-1` means nothing detected.

**Split frames into packets** no larger than `max_packet_size`. The hub
reassembles them.

**Clearing an empty slot reports failure.** Ignore it.

**Do not write your own COBS.** The delimiter is `0x02` and the frame is
XORed with 3; neither is what a textbook implementation does.

---

## Our client

```
editor/src/protocol/
  cobs.js        framing, ported from LEGO's cobs.py
  crc32.js       seeded, 4-byte-aligned CRC-32
  messages.js    encoders for requests, one decoder for everything inbound

editor/src/transport/
  hub-client.js  the conversation: framing, request pairing, chunked upload
  bluetooth.js   Web Bluetooth — a real hub
  websocket.js   WebSocket — the simulator
```

`HubClient` owns the protocol and knows nothing about how bytes travel. A
transport supplies four things:

```js
{
  name,                      // for messages to the user
  connect(),                 // resolves when open
  send(bytes),               // a packet
  disconnect(),
  onData: (bytes) => {},     // assigned by HubClient
}
```

That split is the point: the simulator and a real hub differ only there, so a
program that works against the simulator exercises the same client code that
drives the hardware.

### Using it

```js
import { HubClient } from './transport/hub-client.js';
import { BluetoothTransport } from './transport/bluetooth.js';

const client = new HubClient(new BluetoothTransport());

client.on('console',   (text)     => console.log('hub says:', text));
client.on('program',   ({running}) => console.log('running:', running));
client.on('telemetry', (devices)  => console.log(devices));
client.on('upload',    ({sent, total}) => console.log(sent, '/', total));
client.on('error',     (error)    => console.error(error));

await client.connect();          // InfoRequest, then subscribe to telemetry
await client.run(pythonSource);  // clear, upload, start
await client.stop();
```

`connect()` must be called from a user gesture for Web Bluetooth — the
browser will not open its device picker otherwise.

### Notes on the implementation

- **Responses are paired by message type**, with a 5-second timeout. One
  request of a given type is in flight at a time, which is all the protocol
  needs.
- **Reads are buffered** and split on the delimiter, so fragmentation and
  coalescing are both handled.
- **Writes use `writeValueWithoutResponse`** on BLE, so they queue in order
  and keep up with an upload.
- **Unknown messages are surfaced**, not swallowed. A gap should be loud.

---

## Checking your work

The strongest check available: run **LEGO's own reference client** against
your hub.

```bash
git clone https://github.com/LEGO/spike-prime-docs.git
cd spike-prime-docs/examples/python
pip install bleak
python3 app.py
```

For our own code we go one better. `scripts/gen-vectors.py` generates test
vectors using LEGO's vendored codec, and
[`editor/test/protocol.test.js`](../editor/test/protocol.test.js) checks the
JavaScript against them in both directions. The simulator is tested against
the same codec in Python. So when the tests pass, the editor, the simulator
and a real hub all agree on the bytes.

```bash
cd editor
npm run vectors    # regenerate test/vectors.json
npm test
```

---

## What we have not implemented

Firmware update, hub-to-hub messaging, Bluetooth classic, and the
`ProgramFlowNotification` variants beyond start and stop. None are needed to
write and run a program; all are documented by LEGO if you need them.

## A caution about 2026 hubs

LEGO released a SPIKE Prime hub revision in 2026 with different internal
electronics, requiring different firmware
([pybricks/support#2659](https://github.com/pybricks/support/issues/2659)).
Whether it speaks this protocol identically is **not documented and we have
not been able to confirm it**. Test LEGO's reference client against the exact
hubs you intend to use before relying on any of this.

---

## Sources

- [SPIKE™ Prime protocol documentation](https://lego.github.io/spike-prime-docs/) — the authority
- [LEGO/spike-prime-docs](https://github.com/LEGO/spike-prime-docs) — reference client, Apache 2.0
- [How LEGO® Education uses Web Bluetooth and Web Serial](https://developer.chrome.com/blog/lego-education-spike-web-bluetooth-web-serial)
- [SPIKE Prime Python API](https://tuftsceeo.github.io/SPIKEPythonDocs/SPIKE3.html) — what a program can call

LEGO® and SPIKE™ are trademarks of The LEGO Group, which does not sponsor,
authorise or endorse this project.
