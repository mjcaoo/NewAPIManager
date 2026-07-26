'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

test('NSIS upgrades preserve every writable runtime directory', () => {
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const runtimeDirectories = ['config', 'core', 'data', 'logs', 'backups', 'downloads'];

  for (const directory of runtimeDirectories) {
    assert.match(installer, new RegExp(`PreserveRuntimeDirectory "${directory}"`));
    assert.match(installer, new RegExp(`RestoreRuntimeDirectory "${directory}"`));
  }
});

test('installer does not package local manager configuration', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const configFiles = packageJson.build.extraFiles.find(entry => entry.to === 'config');

  assert.deepEqual(configFiles.filter, ['manager.example.json', 'new-api.env.example']);
});
