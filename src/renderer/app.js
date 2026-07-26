'use strict';

const elements = Object.fromEntries([
  'statusBadge', 'serviceUrl', 'serviceMeta', 'startButton', 'stopButton', 'restartButton',
  'consoleButton', 'importButton', 'checkUpdateButton', 'installUpdateButton', 'updateInfo',
  'progressWrap', 'progress', 'progressText', 'backupButton', 'portInput', 'autoStartCore',
  'startMinimized', 'runAtLogin', 'includePrereleases', 'saveSettingsButton', 'pathsList',
  'logOutput', 'clearLogsButton', 'toast'
].map(id => [id, document.getElementById(id)]));

let snapshot = null;
let currentRelease = null;
let toastTimer = null;

const stateLabels = {
  stopped: '已停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  crashed: '异常退出'
};

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 4500);
}

function formatVersion(version) {
  if (!version?.tag) return '未安装';
  return version.tag;
}

function renderStatus(status) {
  snapshot.status = status;
  const running = ['running', 'starting'].includes(status.state);
  elements.statusBadge.textContent = stateLabels[status.state] || status.state;
  elements.statusBadge.className = `badge ${status.state}`;
  elements.serviceUrl.textContent = status.url;
  elements.serviceMeta.textContent = `PID：${status.pid || '—'}　版本：${formatVersion(status.version)}`;
  elements.startButton.disabled = running || !status.coreExists;
  elements.stopButton.disabled = !running;
  elements.restartButton.disabled = !running;
  elements.consoleButton.disabled = status.state !== 'running';
}

function renderSnapshot(data) {
  snapshot = data;
  renderStatus(data.status);
  elements.portInput.value = data.config.port;
  elements.autoStartCore.checked = data.config.autoStartCore;
  elements.startMinimized.checked = data.config.startMinimized;
  elements.runAtLogin.checked = data.config.runManagerAtLogin;
  elements.includePrereleases.checked = data.config.includePrereleases;
  const labels = { root: '应用根目录', data: '数据库与数据', logs: '运行日志', backups: '数据备份', config: '配置文件', core: '核心程序' };
  elements.pathsList.innerHTML = Object.entries(data.paths)
    .map(([key, value]) => `<dt>${labels[key]}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

async function action(button, task, successMessage) {
  button.disabled = true;
  try {
    const result = await task();
    if (successMessage) showToast(successMessage);
    return result;
  } catch (error) {
    showToast(error.message || String(error), true);
    throw error;
  } finally {
    button.disabled = false;
    if (snapshot?.status) renderStatus(snapshot.status);
  }
}

async function initialize() {
  renderSnapshot(await window.manager.getSnapshot());

  elements.startButton.addEventListener('click', () => action(elements.startButton, () => window.manager.startCore(), '核心已启动'));
  elements.stopButton.addEventListener('click', () => action(elements.stopButton, () => window.manager.stopCore(), '核心已停止'));
  elements.restartButton.addEventListener('click', () => action(elements.restartButton, () => window.manager.restartCore(), '核心已重启'));
  elements.consoleButton.addEventListener('click', () => window.manager.openConsole());
  elements.importButton.addEventListener('click', async () => {
    const status = await action(elements.importButton, () => window.manager.importCore(), '核心已导入');
    if (status) renderStatus(status);
  });

  elements.checkUpdateButton.addEventListener('click', async () => {
    currentRelease = await action(elements.checkUpdateButton, () => window.manager.checkUpdate());
    const size = currentRelease.asset.size ? `${(currentRelease.asset.size / 1024 / 1024).toFixed(1)} MB` : '未知大小';
    elements.updateInfo.textContent = `${currentRelease.name}｜${currentRelease.asset.name}｜${size}` +
      (currentRelease.updateAvailable ? '｜有可用更新' : '｜当前已是最新版本');
    elements.installUpdateButton.disabled = !currentRelease.updateAvailable;
  });

  elements.installUpdateButton.addEventListener('click', async () => {
    await action(elements.installUpdateButton, () => window.manager.installUpdate(currentRelease), `已升级到 ${currentRelease.tag}`);
    renderSnapshot(await window.manager.getSnapshot());
    elements.installUpdateButton.disabled = true;
  });

  elements.backupButton.addEventListener('click', async () => {
    const target = await action(elements.backupButton, () => window.manager.createBackup());
    showToast(`备份完成：${target}`);
  });

  elements.saveSettingsButton.addEventListener('click', async () => {
    const patch = {
      port: Number(elements.portInput.value),
      autoStartCore: elements.autoStartCore.checked,
      startMinimized: elements.startMinimized.checked,
      includePrereleases: elements.includePrereleases.checked
    };
    await action(elements.saveSettingsButton, async () => {
      await window.manager.saveConfig(patch);
      await window.manager.setLoginItem(elements.runAtLogin.checked);
    }, '设置已保存');
    renderSnapshot(await window.manager.getSnapshot());
  });

  document.querySelectorAll('[data-open]').forEach(button => {
    button.addEventListener('click', () => window.manager.openPath(button.dataset.open).catch(error => showToast(error.message, true)));
  });
  elements.clearLogsButton.addEventListener('click', () => { elements.logOutput.textContent = ''; });

  window.manager.onStatus(renderStatus);
  window.manager.onLog(line => {
    if (elements.logOutput.textContent === '等待核心输出…') elements.logOutput.textContent = '';
    elements.logOutput.textContent += line;
    if (elements.logOutput.textContent.length > 200000) {
      elements.logOutput.textContent = elements.logOutput.textContent.slice(-150000);
    }
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  });
  window.manager.onUpdateProgress(progress => {
    if (!progress) {
      elements.progressWrap.classList.add('hidden');
      return;
    }
    elements.progressWrap.classList.remove('hidden');
    if (progress.percent !== null) {
      elements.progress.value = progress.percent;
      elements.progressText.textContent = `${progress.percent}%`;
    } else {
      elements.progress.removeAttribute('value');
      elements.progressText.textContent = `${(progress.received / 1024 / 1024).toFixed(1)} MB`;
    }
  });
}

initialize().catch(error => showToast(error.message || String(error), true));
