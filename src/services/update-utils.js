'use strict';

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function parseVersion(version) {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-.]?([a-zA-Z]+)[.-]?(\d+)?)?/);
  if (!match) return { numeric: [], prerelease: normalized || null, prereleaseNumber: 0 };
  return {
    numeric: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
    prerelease: match[4] ? match[4].toLowerCase() : null,
    prereleaseNumber: Number(match[5] || 0)
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < Math.max(a.numeric.length, b.numeric.length); i += 1) {
    const av = a.numeric[i] || 0;
    const bv = b.numeric[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease !== b.prerelease) return String(a.prerelease) > String(b.prerelease) ? 1 : -1;
  if (a.prereleaseNumber !== b.prereleaseNumber) return a.prereleaseNumber > b.prereleaseNumber ? 1 : -1;
  return 0;
}

function scoreWindowsAsset(name) {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.endsWith('.exe')) score += 80;
  if (lower.endsWith('.zip')) score += 40;
  if (/windows|win32|win64/.test(lower)) score += 50;
  if (/amd64|x86_64|x64/.test(lower)) score += 35;
  if (/arm64|aarch64/.test(lower)) score -= 100;
  if (/sha256|checksum|sig|blockmap/.test(lower)) score -= 200;
  if (/new[-_]?api/.test(lower)) score += 20;
  return score;
}

function selectWindowsAsset(assets) {
  return [...(assets || [])]
    .map(asset => ({ asset, score: scoreWindowsAsset(asset.name || '') }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.asset.size || 0) - (b.asset.size || 0))[0]?.asset || null;
}

module.exports = { normalizeVersion, compareVersions, scoreWindowsAsset, selectWindowsAsset };
