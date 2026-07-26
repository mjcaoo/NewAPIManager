# Repository Guide

## Scope

- This is a Windows x64 CommonJS Electron app. `src/main.js` owns app startup, tray behavior, service wiring, and IPC; `src/preload.js` is the sandboxed renderer API; `src/renderer/` has no Node access.
- The managed `new-api.exe` remains a separate child process. Do not fold core code or data into the Electron app.

## Commands

- Install from the committed lockfile with `npm ci`.
- Run syntax checks with `npm run check`; it checks an explicit file list, so add new runtime JavaScript files to that script.
- Run all tests with `npm test`; focus one test with `node --test --test-name-pattern="<pattern>" tests/update-utils.test.js`.
- Use `npm start` for normal execution and `npm run dev` only when `NODE_ENV=development` is needed.
- Build an unpacked Windows app with `npm run dist:dir`; build NSIS and portable artifacts with `npm run dist:win`.
- Before packaging, run `npm run check` then `npm test`.

## Runtime Layout

- `src/utils/paths.js` is the source of truth for writable paths. Development uses the repository root; installed builds use the executable directory; portable builds must use `PORTABLE_EXECUTABLE_DIR`. `NEW_API_MANAGER_ROOT` is the explicit override useful for isolated runs.
- The app writes under `config/`, `core/`, `data/`, `logs/`, `backups/`, and `downloads/`. Treat `config/manager.json`, `config/new-api.env`, core binaries/version metadata, databases, logs, backups, downloads, and `dist/` as runtime/generated state, not source fixtures.
- The application root must be writable. Packaging is deliberately per-user; changes must not redirect portable data into Electron's temporary extraction directory or assume `Program Files` is writable.
- `PORT` and `SQLITE_PATH` are always forced by `CoreManager` after merging process, manager, and `config/new-api.env` variables. Do not make the env file authoritative for those two values.

## Lifecycle Constraints

- Preserve the core state machine in `src/services/core-manager.js`: start checks the port, spawns hidden, captures logs, and waits for HTTP health; stop may fall back to Windows `taskkill.exe /T /F` because graceful Unix signals are unavailable.
- Backups intentionally stop a running core, copy `data/` plus manager/env config, and restart it in `finally`.
- Restores only accept directories under `backups/`, create a `before-restore` safety backup, replace data/config while stopped, reload manager config, and roll back if the restored core fails its health restart.
- Upgrades intentionally stop the core, download to a `.part` file, optionally verify GitHub's SHA-256 digest, stage archives through PowerShell `Expand-Archive`, back up, preserve the old binary under `core/versions/`, replace atomically, and roll back if restart health checks fail. Keep this ordering when changing update behavior.
- Upstream asset selection is Windows x64 only and prefers `.exe` over `.zip`; update `src/services/update-utils.js` and its tests together if release naming support changes.

## Change Boundaries

- Renderer privileges must continue through `contextBridge` and named IPC handlers. When adding a UI operation, update `src/preload.js` and `src/main.js`; do not enable renderer `nodeIntegration` or weaken the CSP/context isolation/sandbox settings.
- `package.json` packages only `src/**/*`, `package.json`, and `THIRD_PARTY_NOTICE.md`, with `core/` and `config/` copied as `extraFiles`. Add required runtime files to the builder configuration or they will be absent from packaged artifacts.
- If distributing a bundled New API binary, preserve the upstream AGPLv3 attribution and obligations documented in `THIRD_PARTY_NOTICE.md`.
