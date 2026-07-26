'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = Object.freeze({
  port: 3000,
  host: '127.0.0.1',
  autoStartCore: true,
  startMinimized: false,
  runManagerAtLogin: false,
  includePrereleases: true,
  githubRepository: 'QuantumNous/new-api',
  healthCheckPath: '/',
  startupTimeoutSeconds: 45,
  shutdownTimeoutSeconds: 8,
  environment: {
    GIN_MODE: 'release'
  }
});

class ConfigStore {
  constructor(paths) {
    this.paths = paths;
    this.config = null;
  }

  load() {
    let userConfig = {};
    if (fs.existsSync(this.paths.managerConfig)) {
      try {
        userConfig = JSON.parse(fs.readFileSync(this.paths.managerConfig, 'utf8'));
      } catch (error) {
        const badPath = `${this.paths.managerConfig}.invalid-${Date.now()}`;
        fs.renameSync(this.paths.managerConfig, badPath);
      }
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      environment: {
        ...DEFAULT_CONFIG.environment,
        ...(userConfig.environment || {})
      }
    };

    this.validate(this.config);
    this.save();
    this.ensureEnvFile();
    return this.get();
  }

  get() {
    return structuredClone(this.config || DEFAULT_CONFIG);
  }

  update(patch) {
    const next = {
      ...this.config,
      ...patch,
      environment: patch.environment
        ? { ...this.config.environment, ...patch.environment }
        : this.config.environment
    };
    this.validate(next);
    this.config = next;
    this.save();
    return this.get();
  }

  validate(config) {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error('端口必须是 1～65535 的整数。');
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(config.host)) {
      throw new Error('监听主机名格式不正确。');
    }
    if (!/^[-\w]+\/[-\w.]+$/.test(config.githubRepository)) {
      throw new Error('GitHub 仓库格式必须为 owner/repository。');
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.paths.managerConfig), { recursive: true });
    const temp = `${this.paths.managerConfig}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.paths.managerConfig);
  }

  ensureEnvFile() {
    if (!fs.existsSync(this.paths.envFile)) {
      fs.writeFileSync(
        this.paths.envFile,
        [
          '# 这里的变量会传递给 new-api.exe。',
          '# 管理器会强制覆盖 PORT 与 SQLITE_PATH，确保数据位于应用目录。',
          '# 示例：MEMORY_CACHE_ENABLED=true',
          ''
        ].join('\n'),
        'utf8'
      );
    }
  }

  readEnvFile() {
    if (!fs.existsSync(this.paths.envFile)) return {};
    const result = {};
    for (const rawLine of fs.readFileSync(this.paths.envFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) result[key] = value;
    }
    return result;
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
