'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('handDetail', {
  getHandDetail: (handId, perspectivePlayer, options) => ipcRenderer.invoke('get-hand-detail', handId, perspectivePlayer, options),
  downloadHandImage: (handId, contentHeight) => ipcRenderer.invoke('download-hand-image', handId, contentHeight),
  getQuickPlayerStats: (playerNames) => ipcRenderer.invoke('get-quick-player-stats', playerNames),
  fitWindowToContent: (contentHeight) => ipcRenderer.invoke('hand-window-fit-content', contentHeight),
});
