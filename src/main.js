'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getPaths, ensureDirectories, assertWritable } = require('./utils/paths');
const { ConfigStore } = require('./services/config-store');
const { CoreManager } = require('./services/core-manager');
const { BackupService } = require('./services/backup-service');
const { UpdateService } = require('./services/update-service');

let mainWindow = null;
let tray = null;
let paths;
let configStore;
let coreManager;
let backupService;
let updateService;
let isQuitting = false;

function appIconPath() {
  return path.join(__dirname, 'assets', 'icon.png');
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'New API Manager',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!configStore.get().startMinimized) mainWindow.show();
  });
  mainWindow.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const status = coreManager.getStatus();
  const running = ['running', 'starting'].includes(status.state);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `New API：${status.state}`, enabled: false },
    { type: 'separator' },
    { label: '打开管理器', click: showWindow },
    { label: '打开 New API 控制台', enabled: running, click: () => shell.openExternal(status.url) },
    { type: 'separator' },
    { label: '启动核心', enabled: !running, click: () => coreManager.start().catch(showError) },
    { label: '停止核心', enabled: running, click: () => coreManager.stop().catch(showError) },
    { label: '重启核心', enabled: running, click: () => coreManager.restart().catch(showError) },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(appIconPath()).resize({ width: 16, height: 16 }));
  tray.setToolTip('New API Manager');
  tray.on('double-click', showWindow);
  rebuildTrayMenu();
}

function showError(error) {
  dialog.showErrorBox('New API Manager', error?.message || String(error));
}

function registerIpc() {
  ipcMain.handle('manager:get-snapshot', () => ({
    status: coreManager.getStatus(),
    config: configStore.get(),
    paths: {
      root: paths.root,
      data: paths.dataDir,
      logs: paths.logsDir,
      backups: paths.backupsDir,
      config: paths.configDir,
      core: paths.currentCoreDir
    }
  }));

  ipcMain.handle('core:start', () => coreManager.start());
  ipcMain.handle('core:stop', () => coreManager.stop());
  ipcMain.handle('core:restart', () => coreManager.restart());
  ipcMain.handle('core:open-console', () => shell.openExternal(coreManager.getStatus().url));

  ipcMain.handle('core:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 new-api.exe',
      properties: ['openFile'],
      filters: [{ name: 'New API 可执行文件', extensions: ['exe'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wasRunning = ['running', 'starting'].includes(coreManager.getStatus().state);
    if (wasRunning) await coreManager.stop();
    fs.copyFileSync(result.filePaths[0], paths.coreExe);
    fs.writeFileSync(paths.versionFile, `${JSON.stringify({
      tag: 'manual',
      installedAt: new Date().toISOString(),
      source: result.filePaths[0]
    }, null, 2)}\n`, 'utf8');
    if (wasRunning) await coreManager.start();
    return coreManager.getStatus();
  });

  ipcMain.handle('manager:open-path', async (_event, kind) => {
    const mapping = {
      root: paths.root,
      data: paths.dataDir,
      logs: paths.logsDir,
      backups: paths.backupsDir,
      config: paths.configDir,
      core: paths.currentCoreDir
    };
    const target = mapping[kind];
    if (!target) throw new Error('未知目录。');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('config:save', async (_event, patch) => {
    const previous = configStore.get();
    const next = configStore.update({
      ...patch,
      port: Number(patch.port)
    });
    if (previous.port !== next.port && coreManager.getStatus().state === 'running') {
      await coreManager.restart();
    }
    return next;
  });

  ipcMain.handle('manager:set-login-item', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true });
    return configStore.update({ runManagerAtLogin: Boolean(enabled) });
  });

  ipcMain.handle('backup:create', () => backupService.createBackup('manual'));
  ipcMain.handle('backup:restore', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要恢复的备份目录',
      defaultPath: paths.backupsDir,
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['取消', '恢复'],
      defaultId: 0,
      cancelId: 0,
      title: '确认恢复备份',
      message: '恢复会替换当前数据与配置。',
      detail: '管理器会先创建恢复前备份；如果核心重启失败，将尝试自动回滚。'
    });
    if (confirmation.response !== 1) return null;
    const restored = await backupService.restoreBackup(result.filePaths[0]);
    app.setLoginItemSettings({
      openAtLogin: configStore.get().runManagerAtLogin,
      openAsHidden: true
    });
    return restored;
  });
  ipcMain.handle('update:check', () => updateService.check());
  ipcMain.handle('update:install', (_event, release) => updateService.install(release));
}

async function initialize() {
  paths = getPaths();
  ensureDirectories(paths);
  assertWritable(paths.root);
  configStore = new ConfigStore(paths);
  configStore.load();
  coreManager = new CoreManager(paths, configStore);
  backupService = new BackupService(paths, coreManager, configStore);
  updateService = new UpdateService(paths, configStore, coreManager, backupService);

  coreManager.on('status', status => {
    send('core:status', status);
    rebuildTrayMenu();
  });
  coreManager.on('log', line => send('core:log', line));
  updateService.on('progress', progress => send('update:progress', progress));

  registerIpc();
  createTray();
  createWindow();

  app.setLoginItemSettings({
    openAtLogin: configStore.get().runManagerAtLogin,
    openAsHidden: true
  });

  if (configStore.get().autoStartCore && fs.existsSync(paths.coreExe)) {
    coreManager.start().catch(error => {
      send('core:log', `[MANAGER] 自动启动失败：${error.message}\n`);
      showWindow();
      showError(error);
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(initialize).catch(error => {
    showError(error);
    app.quit();
  });
}

app.on('before-quit', async event => {
  if (!isQuitting) isQuitting = true;
  if (coreManager && coreManager.getStatus().state !== 'stopped') {
    event.preventDefault();
    try { await coreManager.stop(); } finally { app.exit(0); }
  }
});

app.on('window-all-closed', () => {
  // Keep running in the Windows notification area.
});
