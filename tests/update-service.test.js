'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UpdateService } = require('../src/services/update-service');

function createService(fetch) {
  return new UpdateService({}, {}, {}, {}, fetch);
}

test('uses the injected Electron fetch implementation for GitHub requests', async () => {
  let request = null;
  const service = createService(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([{ tag_name: 'v1.0.0' }]), {
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const releases = await service.getJson('https://api.github.com/releases');

  assert.equal(releases[0].tag_name, 'v1.0.0');
  assert.equal(request.url, 'https://api.github.com/releases');
  assert.equal(request.options.headers['User-Agent'], 'New-API-Manager');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('downloads through the injected Electron fetch implementation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'new-api-manager-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'new-api.exe');
  const progress = [];
  const service = createService(async () => new Response(Buffer.from('new-api-binary'), {
    headers: { 'Content-Length': '14' }
  }));

  await service.download('https://github.com/new-api.exe', destination, state => progress.push(state));

  assert.equal(fs.readFileSync(destination, 'utf8'), 'new-api-binary');
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(fs.existsSync(`${destination}.part`), false);
});
