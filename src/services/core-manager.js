'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { formatLocalIso, formatLocalDate } = require('../utils/time');

const STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  CRASHED: 'crashed'
});

class CoreManager extends EventEmitter {
  constructor(paths, configStore) {
    super();
    this.paths = paths;
    this.configStore = configStore;
    this.process = null;
    this.state = STATES.STOPPED;
    this.startedAt = null;
    this.lastExit = null;
    this.logStream = null;
    this.expectedStop = false;
  }

  getStatus() {
    const config = this.configStore.get();
    return {
      state: this.state,
      pid: this.process?.pid || null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      coreExists: fs.existsSync(this.paths.coreExe),
      url: `http://${config.host}:${config.port}`,
      version: this.readInstalledVersion()
    };
  }

  readInstalledVersion() {
    try {
      return JSON.parse(fs.readFileSync(this.paths.versionFile, 'utf8'));
    } catch {
      return { tag: fs.existsSync(this.paths.coreExe) ? 'unknown' : null, source: null };
    }
  }

  setState(state) {
    this.state = state;
    this.emit('status', this.getStatus());
  }

  async start() {
    if ([STATES.STARTING, STATES.RUNNING].includes(this.state)) return this.getStatus();
    if (!fs.existsSync(this.paths.coreExe)) {
      throw new Error('尚未安装 new-api.exe。请先导入本地核心或执行在线升级。');
    }

    const config = this.configStore.get();
    await this.assertPortFree(config.host, config.port);

    fs.mkdirSync(this.paths.coreLogsDir, { recursive: true });
    const logName = `new-api-${formatLocalDate()}.log`;
    this.logStream = fs.createWriteStream(path.join(this.paths.coreLogsDir, logName), { flags: 'a' });

    const envFromFile = this.configStore.readEnvFile();
    const managerEnvironment = { ...config.environment };
    delete managerEnvironment.TZ;
    const env = {
      ...process.env,
      ...managerEnvironment,
      ...envFromFile,
      PORT: String(config.port),
      SQLITE_PATH: this.paths.sqliteFile
    };

    this.expectedStop = false;
    this.startedAt = formatLocalIso();
    this.lastExit = null;
    this.setState(STATES.STARTING);

    this.process = spawn(this.paths.coreExe, [], {
      cwd: this.paths.root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', chunk => this.writeLog('OUT', chunk));
    this.process.stderr.on('data', chunk => this.writeLog('ERR', chunk));
    this.process.once('error', error => {
      this.writeLog('MANAGER', Buffer.from(`启动失败：${error.stack || error.message}\n`));
    });
    this.process.once('exit', (code, signal) => {
      this.lastExit = { code, signal, at: formatLocalIso(), expected: this.expectedStop };
      this.process = null;
      this.startedAt = null;
      this.logStream?.end();
      this.logStream = null;
      this.setState(this.expectedStop ? STATES.STOPPED : STATES.CRASHED);
    });

    await this.waitForHealthy(config.startupTimeoutSeconds * 1000);
    this.setState(STATES.RUNNING);
    return this.getStatus();
  }

  async stop() {
    if (!this.process || [STATES.STOPPED, STATES.STOPPING].includes(this.state)) {
      this.setState(STATES.STOPPED);
      return this.getStatus();
    }

    this.expectedStop = true;
    this.setState(STATES.STOPPING);
    const processRef = this.process;
    const timeout = this.configStore.get().shutdownTimeoutSeconds * 1000;

    // On Windows, Node cannot send a Unix-style SIGTERM to a hidden console process.
    // kill() terminates the child; the timeout fallback also removes descendants.
    try { processRef.kill(); } catch {}

    const exited = await this.waitForExit(processRef, timeout);
    if (!exited && processRef.pid) {
      await this.forceKillTree(processRef.pid);
      await this.waitForExit(processRef, 3000);
    }

    if (this.process === processRef) {
      this.process = null;
      this.startedAt = null;
      this.logStream?.end();
      this.logStream = null;
      this.setState(STATES.STOPPED);
    }
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  writeLog(channel, chunk) {
    const text = chunk.toString('utf8');
    const line = `[${formatLocalIso()}] [${channel}] ${text}`;
    this.logStream?.write(line);
    this.emit('log', line);
  }

  waitForExit(processRef, timeoutMs) {
    if (!processRef || processRef.exitCode !== null) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      const finish = value => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      processRef.once('exit', () => finish(true));
      timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  forceKillTree(pid) {
    return new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  }

  async waitForHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      if (!this.process) throw new Error('New API 在健康检查完成前退出。请查看核心日志。');
      try {
        await this.healthCheck();
        return;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    }
    await this.stop();
    throw new Error(`启动超时：${lastError?.message || '服务未响应'}`);
  }

  healthCheck() {
    const config = this.configStore.get();
    return new Promise((resolve, reject) => {
      const request = http.get({
        host: config.host,
        port: config.port,
        path: config.healthCheckPath || '/',
        timeout: 2500
      }, response => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else reject(new Error(`HTTP ${response.statusCode}`));
      });
      request.once('timeout', () => request.destroy(new Error('健康检查超时')));
      request.once('error', reject);
    });
  }

  assertPortFree(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      let settled = false;
      const finish = callback => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback();
      };
      socket.setTimeout(1000);
      socket.once('connect', () => finish(() => reject(
        new Error(`端口 ${port} 已被占用。请停止现有实例或修改端口。`)
      )));
      socket.once('timeout', () => finish(resolve));
      socket.once('error', error => {
        if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') finish(resolve);
        else finish(() => reject(new Error(`检查端口 ${port} 失败：${error.message}`)));
      });
    });
  }
}

module.exports = { CoreManager, STATES };
