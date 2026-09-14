/**
 * Telling a local copy from a hosted one.
 *
 * Getting this backwards is quietly bad in both directions: a local copy that
 * refuses to reach its own simulator, or a hosted copy that tries anyway and
 * reports "could not reach the simulator" when the real reason is that the
 * browser will never allow it.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isLocalOrigin, REPO_URL } from '../src/environment.js';

describe('is the simulator reachable from here', () => {
  it('says yes for the ways a local copy gets opened', () => {
    for (const location of [
      { hostname: 'localhost', protocol: 'http:' },
      { hostname: '127.0.0.1', protocol: 'http:' },
      { hostname: '[::1]', protocol: 'http:' },
      { hostname: 'editor.localhost', protocol: 'http:' },
      { hostname: '', protocol: 'file:' },
    ]) {
      assert.equal(isLocalOrigin(location), true, JSON.stringify(location));
    }
  });

  it('says no for anything served from the web', () => {
    for (const location of [
      { hostname: 'a11ybob.com', protocol: 'https:' },
      { hostname: 'www.a11ybob.com', protocol: 'https:' },
      { hostname: 'example.github.io', protocol: 'https:' },
    ]) {
      assert.equal(isLocalOrigin(location), false, JSON.stringify(location));
    }
  });

  it('is not fooled by a hostname that merely contains localhost', () => {
    assert.equal(isLocalOrigin({ hostname: 'localhost.example.com', protocol: 'https:' }), false);
    assert.equal(isLocalOrigin({ hostname: 'notlocalhost', protocol: 'https:' }), false);
  });

  it('treats a machine on the same network as remote', () => {
    // Its loopback is not the browser's, so the simulator is still out of reach.
    assert.equal(isLocalOrigin({ hostname: '192.168.1.10', protocol: 'http:' }), false);
  });

  it('copes with no location at all', () => {
    assert.equal(isLocalOrigin({}), false);
  });
});

describe('where the project lives', () => {
  it('points at somewhere real', () => {
    assert.match(REPO_URL, /^https:\/\/github\.com\/[\w-]+\/[\w-]+$/);
  });
});
