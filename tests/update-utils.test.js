'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, selectWindowsAsset } = require('../src/services/update-utils');

test('version comparison handles rc increments', () => {
  assert.equal(compareVersions('v1.0.0-rc.21', 'v1.0.0-rc.20'), 1);
  assert.equal(compareVersions('v1.0.0-rc.20', 'v1.0.0-rc.20'), 0);
  assert.equal(compareVersions('v1.0.0', 'v1.0.0-rc.21'), 1);
});

test('selects Windows x64 executable over other assets', () => {
  const selected = selectWindowsAsset([
    { name: 'new-api-linux-amd64' },
    { name: 'new-api-windows-arm64.exe' },
    { name: 'new-api-windows-amd64.exe' },
    { name: 'checksums.txt' }
  ]);
  assert.equal(selected.name, 'new-api-windows-amd64.exe');
});
