'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCoreVersion, parseGoModuleVersion } = require('../src/services/core-version');

test('parses a New API version from command output', () => {
  assert.equal(parseCoreVersion('v1.0.0-rc.21\n'), 'v1.0.0-rc.21');
  assert.equal(parseCoreVersion('New API 0.6.11 started'), '0.6.11');
});

test('returns null when command output has no semantic version', () => {
  assert.equal(parseCoreVersion('unknown'), null);
  assert.equal(parseCoreVersion(''), null);
});

test('reads the version embedded in Go module build information', () => {
  const buildInfo = Buffer.from(
    'path\tgithub.com/QuantumNous/new-api\n' +
    'mod\tgithub.com/QuantumNous/new-api\tv1.0.0-rc.21\t\n'
  );
  assert.equal(parseGoModuleVersion(buildInfo), 'v1.0.0-rc.21');
  assert.equal(parseGoModuleVersion('unrelated binary data'), null);
});
