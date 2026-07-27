'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { selectWindowsAsset, compareVersions } = require('./update-utils');
const { formatLocalIso } = require('../utils/time');

class UpdateService extends EventEmitter {
  constructor(paths, configStore, coreManager, backupService, fetch) {
    super();
    this.paths = paths;
    this.configStore = configStore;
    this.coreManager = coreManager;
    this.backupService = backupService;
    this.fetch = fetch;
    this.latestRelease = null;
  }

  async check() {
    const config = this.configStore.get();
    const releases = await this.getJson(
      `https://api.github.com/repos/${config.githubRepository}/releases?per_page=20`
    );
    const release = releases.find(item =>
      !item.draft && (config.includePrereleases || !item.prerelease)
    );
    if (!release) throw new Error('GitHub 未返回可用版本。');

    const asset = selectWindowsAsset(release.assets);
    if (!asset) {
      throw new Error('最新版本中没有找到 Windows x64 可执行文件或压缩包。');
    }

    const current = this.coreManager.readInstalledVersion();
    this.latestRelease = {
      tag: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at,
      prerelease: release.prerelease,
      htmlUrl: release.html_url,
      notes: release.body || '',
      asset: {
        name: asset.name,
        size: asset.size,
        url: asset.browser_download_url,
        digest: asset.digest || null
      },
      currentTag: current.tag,
      updateAvailable: !current.tag || current.tag === 'unknown' || compareVersions(release.tag_name, current.tag) > 0
    };
    return this.latestRelease;
  }

  async install(release = this.latestRelease) {
    if (!release?.asset?.url) release = await this.check();

    const wasRunning = ['running', 'starting'].includes(this.coreManager.getStatus().state);
    const oldVersionMetadata = this.coreManager.readInstalledVersion();
    let completed = false;
    let previousBinary = null;

    if (wasRunning) await this.coreManager.stop();

    const downloadDir = path.join(this.paths.downloadsDir, release.tag.replace(/[^a-zA-Z0-9._-]/g, '_'));
    fs.mkdirSync(downloadDir, { recursive: true });
    const downloadedPath = path.join(downloadDir, release.asset.name);
    const stagingDir = path.join(downloadDir, 'staging');
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    try {
      await this.download(release.asset.url, downloadedPath, progress => this.emit('progress', progress));
      const digest = await this.sha256(downloadedPath);
      if (release.asset.digest?.startsWith('sha256:')) {
        const expected = release.asset.digest.slice('sha256:'.length).toLowerCase();
        if (digest !== expected) throw new Error('SHA-256 校验失败，升级包可能损坏。');
      }

      const candidate = await this.prepareCandidate(downloadedPath, stagingDir);
      if (!candidate || !fs.existsSync(candidate)) throw new Error('升级包内未找到 new-api.exe。');

      await this.backupService.createBackup('before-upgrade');

      if (fs.existsSync(this.paths.coreExe)) {
        const oldVersion = oldVersionMetadata.tag || `unknown-${Date.now()}`;
        const safeVersion = oldVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
        const oldDir = path.join(this.paths.versionsDir, safeVersion);
        fs.mkdirSync(oldDir, { recursive: true });
        previousBinary = path.join(oldDir, 'new-api.exe');
        fs.copyFileSync(this.paths.coreExe, previousBinary);
        fs.writeFileSync(
          path.join(oldDir, 'version.json'),
          `${JSON.stringify(oldVersionMetadata, null, 2)}\n`,
          'utf8'
        );
      }

      const tempTarget = `${this.paths.coreExe}.new`;
      fs.copyFileSync(candidate, tempTarget);
      fs.rmSync(this.paths.coreExe, { force: true });
      fs.renameSync(tempTarget, this.paths.coreExe);
      fs.writeFileSync(
        this.paths.versionFile,
        `${JSON.stringify({
          tag: release.tag,
          installedAt: formatLocalIso(),
          source: release.asset.url,
          sha256: digest,
          asset: release.asset.name
        }, null, 2)}\n`,
        'utf8'
      );

      if (wasRunning) {
        try {
          await this.coreManager.start();
        } catch (error) {
          if (previousBinary) {
            await this.coreManager.stop();
            fs.copyFileSync(previousBinary, this.paths.coreExe);
            fs.writeFileSync(
              this.paths.versionFile,
              `${JSON.stringify(oldVersionMetadata, null, 2)}\n`,
              'utf8'
            );
            await this.coreManager.start();
          }
          throw new Error(`新版本启动失败，已尝试回滚：${error.message}`);
        }
      }

      completed = true;
      return { tag: release.tag, sha256: digest, path: this.paths.coreExe };
    } finally {
      this.emit('progress', null);
      if (!completed && wasRunning && this.coreManager.getStatus().state === 'stopped' && fs.existsSync(this.paths.coreExe)) {
        try { await this.coreManager.start(); } catch {}
      }
    }
  }

  async getJson(url) {
    return this.fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'New-API-Manager',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, 20000, 'GitHub API 请求超时', response => {
      if (!response.ok) throw new Error(`GitHub API 请求失败：HTTP ${response.status}`);
      return response.json();
    });
  }

  async download(url, destination, onProgress) {
    const controller = new AbortController();
    const temp = `${destination}.part`;
    let received = 0;
    let timer = null;
    const refreshTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), 60000);
    };

    try {
      refreshTimeout();
      const response = await this.fetch(url, {
        headers: { 'User-Agent': 'New-API-Manager' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
      if (!response.body) throw new Error('下载响应没有内容。');

      const total = Number(response.headers.get('content-length') || 0);
      const progress = new Transform({
        transform(chunk, _encoding, callback) {
          refreshTimeout();
          received += chunk.length;
          onProgress?.({ received, total, percent: total ? Math.round(received * 100 / total) : null });
          callback(null, chunk);
        }
      });
      await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(temp));
      fs.rmSync(destination, { force: true });
      fs.renameSync(temp, destination);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      if (controller.signal.aborted) throw new Error('下载超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchWithTimeout(url, options, timeoutMs, timeoutMessage, consume = response => response) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(url, { ...options, signal: controller.signal });
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(timeoutMessage);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const input = fs.createReadStream(filePath);
      input.on('data', chunk => hash.update(chunk));
      input.once('end', () => resolve(hash.digest('hex')));
      input.once('error', reject);
    });
  }

  async prepareCandidate(downloadedPath, stagingDir) {
    if (downloadedPath.toLowerCase().endsWith('.exe')) return downloadedPath;
    if (!downloadedPath.toLowerCase().endsWith('.zip')) {
      throw new Error(`不支持的升级包格式：${path.extname(downloadedPath)}`);
    }

    await this.expandArchive(downloadedPath, stagingDir);
    return this.findExe(stagingDir);
  }

  expandArchive(zipPath, destination) {
    return new Promise((resolve, reject) => {
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedDestination = destination.replace(/'/g, "''");
      const command = `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDestination}' -Force`;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`解压失败：${stderr || code}`)));
    });
  }

  findExe(directory) {
    const queue = [directory];
    while (queue.length) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(full);
        else if (entry.name.toLowerCase() === 'new-api.exe') return full;
      }
    }
    return null;
  }
}

module.exports = { UpdateService };
