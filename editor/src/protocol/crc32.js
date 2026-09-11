/**
 * CRC-32 matching LEGO's `crc.py`.
 *
 * Two details that are easy to get wrong and impossible to debug later:
 *
 *  - It is seeded. A client transferring a file in chunks chains the running
 *    CRC from one chunk into the next, so the seed is not optional.
 *  - It zero-pads the data to a 4-byte boundary before hashing. That is why
 *    `max_chunk_size` has to be a multiple of 4: only then does a chained
 *    per-chunk CRC arrive at the same value as a CRC over the whole file.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} data
 * @param {number} [seed] running CRC to continue from
 * @param {number} [align] pad the data up to this boundary with zero bytes
 * @returns {number} unsigned 32-bit CRC
 */
export function crc(data, seed = 0, align = 4) {
  let value = (seed ^ 0xffffffff) >>> 0;

  for (let i = 0; i < data.length; i++) {
    value = (TABLE[(value ^ data[i]) & 0xff] ^ (value >>> 8)) >>> 0;
  }

  // the zero padding is hashed too, exactly as Python's crc() does
  const remainder = data.length % align;
  if (remainder) {
    for (let i = 0; i < align - remainder; i++) {
      value = (TABLE[value & 0xff] ^ (value >>> 8)) >>> 0;
    }
  }

  return (value ^ 0xffffffff) >>> 0;
}
