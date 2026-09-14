/**
 * Where this copy of the editor is running, and what that allows.
 *
 * The simulator is a program on the student's own machine, reached over a
 * plain WebSocket to localhost. A browser will not let a page served from the
 * public web open that connection, for two separate reasons, and neither is
 * something a site can opt out of:
 *
 *  - **Mixed content.** A `ws://` connection from an `https://` page is
 *    blocked. Chrome's WebSocket mixed-content check does not make an
 *    exception for localhost.
 *  - **Local Network Access.** Since Chrome 147 a page on a public origin
 *    reaching a loopback address needs explicit permission, and a secure page
 *    reaching an insecure local one is refused outright.
 *
 * So a hosted copy can do everything except talk to the simulator — including
 * driving a real hub over Web Bluetooth, which needs HTTPS and therefore works
 * better hosted than it does locally.
 *
 * Rather than let the connection fail with a misleading "could not reach the
 * simulator", the editor checks first and explains.
 */

export const REPO_URL = 'https://github.com/bobdodd/Blockly-for-Lego';

// No empty string here: a `file:` URL is caught by its protocol below, and
// treating an unknown location as local would make a hosted copy attempt a
// connection the browser will never allow, then blame the simulator for it.
// Unknown therefore means remote, which at worst shows an explanation.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * True when the simulator could plausibly be reached — the page is being
 * served from the same machine the simulator would run on.
 *
 * @param {{hostname?: string, protocol?: string}} [location]
 */
export function isLocalOrigin(location = globalThis.location ?? {}) {
  const { hostname = '', protocol = '' } = location;
  if (protocol === 'file:') return true;
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  // a machine on the same private network is still a different origin to the
  // browser's loopback, so anything else counts as remote
  return hostname.endsWith('.localhost');
}

