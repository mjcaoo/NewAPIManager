'use strict';

const fs = require('fs');
const path = require('path');

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

class BackupService {
  constructor(paths, coreManager, configStore = null) {
    this.paths = paths;
    this.coreManager = coreManager;
    this.configStore = configStore;
  }

  async createBackup(reason = 'manual') {
    const wasRunning = ['running', 'starting'].includes(this.coreManager.getStatus().state);
    if (wasRunning) await this.coreManager.stop();

    try {
      const target = path.join(this.paths.backupsDir, `${timestampForPath()}-${reason}`);
      fs.mkdirSync(target, { recursive: true });
      if (fs.existsSync(this.paths.dataDir)) {
        fs.cpSync(this.paths.dataDir, path.join(target, 'data'), { recursive: true });
      }
      if (fs.existsSync(this.paths.managerConfig)) {
        fs.copyFileSync(this.paths.managerConfig, path.join(target, 'manager.json'));
      }
      if (fs.existsSync(this.paths.envFile)) {
        fs.copyFileSync(this.paths.envFile, path.join(target, 'new-api.env'));
      }
      fs.writeFileSync(
        path.join(target, 'backup.json'),
        `${JSON.stringify({ createdAt: new Date().toISOString(), reason }, null, 2)}\n`,
        'utf8'
      );
      return target;
    } finally {
      if (wasRunning) await this.coreManager.start();
    }
  }

  validateBackup(source) {
    const backupRoot = path.resolve(this.paths.backupsDir);
    const backupPath = path.resolve(source);
    const relative = path.relative(backupRoot, backupPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('只能恢复备份目录中的备份。');
    }
    if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isDirectory()) {
      throw new Error('所选备份目录不存在。');
    }
    const realBackupRoot = fs.realpathSync(backupRoot);
    const realBackupPath = fs.realpathSync(backupPath);
    const realRelative = path.relative(realBackupRoot, realBackupPath);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error('只能恢复备份目录中的备份。');
    }
    if (!fs.existsSync(path.join(backupPath, 'backup.json'))) {
      throw new Error('所选目录不是有效备份：缺少 backup.json。');
    }
    try {
      JSON.parse(fs.readFileSync(path.join(backupPath, 'backup.json'), 'utf8'));
    } catch {
      throw new Error('所选备份的 backup.json 无效。');
    }
    const backupData = path.join(backupPath, 'data');
    if (!fs.existsSync(backupData) || !fs.statSync(backupData).isDirectory()) {
      throw new Error('所选备份不包含 data 目录。');
    }
    const managerConfig = path.join(backupPath, 'manager.json');
    if (fs.existsSync(managerConfig)) {
      try {
        const config = JSON.parse(fs.readFileSync(managerConfig, 'utf8'));
        this.configStore?.validate(config);
      } catch (error) {
        throw new Error(`所选备份的 manager.json 无效：${error.message}`);
      }
    }
    return backupPath;
  }

  async restoreBackup(source) {
    const backupPath = this.validateBackup(source);
    const wasRunning = ['running', 'starting'].includes(this.coreManager.getStatus().state);
    if (wasRunning) await this.coreManager.stop();

    let safetyBackup;
    try {
      safetyBackup = await this.createBackup('before-restore');
    } catch (error) {
      if (wasRunning) await this.coreManager.start();
      throw error;
    }

    try {
      this.copyBackupToRuntime(backupPath);
      this.configStore?.load();
      if (wasRunning) await this.coreManager.start();
      return { restoredFrom: backupPath, safetyBackup };
    } catch (error) {
      try {
        if (this.coreManager.getStatus().state !== 'stopped') await this.coreManager.stop();
        this.copyBackupToRuntime(safetyBackup);
        this.configStore?.load();
        if (wasRunning) await this.coreManager.start();
      } catch (rollbackError) {
        throw new Error(`恢复失败，且回滚失败：${error.message}；${rollbackError.message}`);
      }
      throw new Error(`恢复失败，已回滚到恢复前状态：${error.message}`);
    }
  }

  copyBackupToRuntime(source) {
    const backupData = path.join(source, 'data');
    const tempData = `${this.paths.dataDir}.restore-${process.pid}-${Date.now()}`;
    fs.rmSync(tempData, { recursive: true, force: true });
    fs.cpSync(backupData, tempData, { recursive: true });
    fs.rmSync(this.paths.dataDir, { recursive: true, force: true });
    fs.renameSync(tempData, this.paths.dataDir);

    const managerConfig = path.join(source, 'manager.json');
    if (fs.existsSync(managerConfig)) fs.copyFileSync(managerConfig, this.paths.managerConfig);
    else fs.rmSync(this.paths.managerConfig, { force: true });

    const envFile = path.join(source, 'new-api.env');
    if (fs.existsSync(envFile)) fs.copyFileSync(envFile, this.paths.envFile);
    else fs.rmSync(this.paths.envFile, { force: true });
  }
}

module.exports = { BackupService };
