'use strict';

const fs = require('fs');
const path = require('path');

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

class BackupService {
  constructor(paths, coreManager) {
    this.paths = paths;
    this.coreManager = coreManager;
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
}

module.exports = { BackupService };
