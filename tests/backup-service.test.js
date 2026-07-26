'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BackupService } = require('../src/services/backup-service');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-api-manager-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = {
    backupsDir: path.join(root, 'backups'),
    dataDir: path.join(root, 'data'),
    managerConfig: path.join(root, 'config', 'manager.json'),
    envFile: path.join(root, 'config', 'new-api.env')
  };
  fs.mkdirSync(paths.backupsDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.managerConfig), { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'new-api.db'), 'current', 'utf8');
  fs.writeFileSync(paths.managerConfig, '{"port":3000}', 'utf8');
  fs.writeFileSync(paths.envFile, 'VALUE=current\n', 'utf8');
  return { root, paths };
}

function createBackup(paths, name, values) {
  const target = path.join(paths.backupsDir, name);
  fs.mkdirSync(path.join(target, 'data'), { recursive: true });
  fs.writeFileSync(path.join(target, 'data', 'new-api.db'), values.data, 'utf8');
  fs.writeFileSync(path.join(target, 'manager.json'), values.config, 'utf8');
  fs.writeFileSync(path.join(target, 'new-api.env'), values.env, 'utf8');
  fs.writeFileSync(path.join(target, 'backup.json'), '{"reason":"test"}', 'utf8');
  return target;
}

test('restores data and configuration while preserving current state', async t => {
  const { paths } = createFixture(t);
  const source = createBackup(paths, 'source', {
    data: 'restored',
    config: '{"port":4000}',
    env: 'VALUE=restored\n'
  });
  const coreManager = {
    state: 'running',
    getStatus() { return { state: this.state }; },
    async stop() { this.state = 'stopped'; },
    async start() { this.state = 'running'; }
  };
  const configStore = { validate() {}, loadCalls: 0, load() { this.loadCalls += 1; } };
  const service = new BackupService(paths, coreManager, configStore);

  const result = await service.restoreBackup(source);

  assert.equal(fs.readFileSync(path.join(paths.dataDir, 'new-api.db'), 'utf8'), 'restored');
  assert.equal(fs.readFileSync(paths.managerConfig, 'utf8'), '{"port":4000}');
  assert.equal(fs.readFileSync(paths.envFile, 'utf8'), 'VALUE=restored\n');
  assert.equal(fs.readFileSync(path.join(result.safetyBackup, 'data', 'new-api.db'), 'utf8'), 'current');
  assert.equal(configStore.loadCalls, 1);
  assert.equal(coreManager.state, 'running');
});

test('rolls back when the restored core fails to start', async t => {
  const { paths } = createFixture(t);
  const source = createBackup(paths, 'source', {
    data: 'broken',
    config: '{"port":5000}',
    env: 'VALUE=broken\n'
  });
  const coreManager = {
    state: 'running',
    starts: 0,
    getStatus() { return { state: this.state }; },
    async stop() { this.state = 'stopped'; },
    async start() {
      this.starts += 1;
      if (this.starts === 1) throw new Error('health check failed');
      this.state = 'running';
    }
  };
  const configStore = { validate() {}, loadCalls: 0, load() { this.loadCalls += 1; } };
  const service = new BackupService(paths, coreManager, configStore);

  await assert.rejects(
    service.restoreBackup(source),
    /已回滚到恢复前状态：health check failed/
  );

  assert.equal(fs.readFileSync(path.join(paths.dataDir, 'new-api.db'), 'utf8'), 'current');
  assert.equal(fs.readFileSync(paths.managerConfig, 'utf8'), '{"port":3000}');
  assert.equal(fs.readFileSync(paths.envFile, 'utf8'), 'VALUE=current\n');
  assert.equal(configStore.loadCalls, 2);
  assert.equal(coreManager.state, 'running');
});

test('rejects directories outside the managed backup root', t => {
  const { root, paths } = createFixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(outside, 'data'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'backup.json'), '{}', 'utf8');
  const service = new BackupService(paths, { getStatus: () => ({ state: 'stopped' }) });

  assert.throws(() => service.validateBackup(outside), /只能恢复备份目录中的备份/);
});
