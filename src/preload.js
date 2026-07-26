'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manager', {
  getSnapshot: () => ipcRenderer.invoke('manager:get-snapshot'),
  startCore: () => ipcRenderer.invoke('core:start'),
  stopCore: () => ipcRenderer.invoke('core:stop'),
  restartCore: () => ipcRenderer.invoke('core:restart'),
  importCore: () => ipcRenderer.invoke('core:import'),
  openConsole: () => ipcRenderer.invoke('core:open-console'),
  openPath: kind => ipcRenderer.invoke('manager:open-path', kind),
  saveConfig: patch => ipcRenderer.invoke('config:save', patch),
  setLoginItem: enabled => ipcRenderer.invoke('manager:set-login-item', enabled),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: release => ipcRenderer.invoke('update:install', release),
  onStatus: callback => ipcRenderer.on('core:status', (_event, status) => callback(status)),
  onLog: callback => ipcRenderer.on('core:log', (_event, line) => callback(line)),
  onUpdateProgress: callback => ipcRenderer.on('update:progress', (_event, progress) => callback(progress))
});
