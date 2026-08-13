'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('handDetail', {
  getHandDetail: (handId, perspectivePlayer, options) => ipcRenderer.invoke('get-hand-detail', handId, perspectivePlayer, options),
  downloadHandImage: (handId, contentHeight) => ipcRenderer.invoke('download-hand-image', handId, contentHeight),
});
