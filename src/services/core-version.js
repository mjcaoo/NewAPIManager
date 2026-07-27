'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

const MODULE_PREFIX = Buffer.from('mod\tgithub.com/QuantumNous/new-api\t');

function parseCoreVersion(output) {
  const text = String(output || '').trim();
  const match = text.match(/(?:^|\s)(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\s|$)/i);
  return match?.[1] || null;
}

function parseGoModuleVersion(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''));
  const start = buffer.indexOf(MODULE_PREFIX);
  if (start === -1) return null;
  const versionStart = start + MODULE_PREFIX.length;
  let versionEnd = versionStart;
  while (versionEnd < buffer.length && ![9, 10, 13].includes(buffer[versionEnd])) versionEnd += 1;
  return parseCoreVersion(buffer.subarray(versionStart, versionEnd).toString('utf8'));
}

function detectGoModuleVersion(executable) {
  return new Promise(resolve => {
    const stream = fs.createReadStream(executable, { highWaterMark: 64 * 1024 });
    let remainder = Buffer.alloc(0);
    let settled = false;
    const finish = version => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(version);
    };

    stream.on('data', chunk => {
      const data = Buffer.concat([remainder, chunk]);
      const version = parseGoModuleVersion(data);
      if (version) {
        finish(version);
        return;
      }
      remainder = data.subarray(Math.max(0, data.length - MODULE_PREFIX.length - 128));
    });
    stream.once('end', () => finish(null));
    stream.once('error', () => finish(null));
  });
}

function detectCommandVersion(executable) {
  return new Promise(resolve => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'VERSION')
    );
    execFile(executable, ['--version'], {
      encoding: 'utf8',
      env,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve(parseCoreVersion(`${stdout || ''}\n${stderr || ''}`));
    });
  });
}

async function detectCoreVersion(executable) {
  return await detectGoModuleVersion(executable) || await detectCommandVersion(executable);
}

module.exports = { parseCoreVersion, parseGoModuleVersion, detectCoreVersion };
