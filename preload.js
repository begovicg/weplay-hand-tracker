'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weplayConverter', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  parseZipBuffer: (arrayBuffer, zipName) => ipcRenderer.invoke('parse-zip-buffer', arrayBuffer, zipName),
  convertFiles: (files, options) => ipcRenderer.invoke('convert-files', files, options),
  getPersistentStats: (filters) => ipcRenderer.invoke('get-persistent-stats', filters),
  saveResults: (results) => ipcRenderer.invoke('save-results', results),
  importToHandStore: (files, options) => ipcRenderer.invoke('import-to-hand-store', files, options),
  exportFilteredHands: (filters, format) => ipcRenderer.invoke('export-filtered-hands', filters, format),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),
  queryHands: (filters) => ipcRenderer.invoke('query-hands', filters),
  getFilterOptions: (filters) => ipcRenderer.invoke('get-filter-options', filters),
  getAllPlayers: () => ipcRenderer.invoke('get-all-players'),
  openHandWindow: (handId, perspectivePlayer) => ipcRenderer.invoke('open-hand-window', handId, perspectivePlayer),
});
