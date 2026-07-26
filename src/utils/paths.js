'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getAppRoot() {
  if (process.env.NEW_API_MANAGER_ROOT) {
    return path.resolve(process.env.NEW_API_MANAGER_ROOT);
  }

  // electron-builder portable apps are extracted to a temp directory.
  // This variable points to the directory containing the original portable EXE.
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  }

  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }

  return path.resolve(__dirname, '..', '..');
}

function getPaths() {
  const root = getAppRoot();
  return {
    root,
    coreDir: path.join(root, 'core'),
    currentCoreDir: path.join(root, 'core', 'current'),
    versionsDir: path.join(root, 'core', 'versions'),
    coreExe: path.join(root, 'core', 'current', 'new-api.exe'),
    versionFile: path.join(root, 'core', 'current', 'version.json'),
    configDir: path.join(root, 'config'),
    managerConfig: path.join(root, 'config', 'manager.json'),
    envFile: path.join(root, 'config', 'new-api.env'),
    dataDir: path.join(root, 'data'),
    sqliteFile: path.join(root, 'data', 'new-api.db'),
    logsDir: path.join(root, 'logs'),
    coreLogsDir: path.join(root, 'logs', 'core'),
    backupsDir: path.join(root, 'backups'),
    downloadsDir: path.join(root, 'downloads')
  };
}

function ensureDirectories(paths) {
  const directories = [
    paths.coreDir,
    paths.currentCoreDir,
    paths.versionsDir,
    paths.configDir,
    paths.dataDir,
    paths.logsDir,
    paths.coreLogsDir,
    paths.backupsDir,
    paths.downloadsDir
  ];

  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function assertWritable(root) {
  const probe = path.join(root, `.write-test-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
  } catch (error) {
    const wrapped = new Error(
      `应用目录不可写：${root}\n` +
      '请使用便携版，或安装到当前用户有写入权限的目录（建议 LocalAppData\\Programs）。'
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = { getAppRoot, getPaths, ensureDirectories, assertWritable };
