'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// One-way push from main (src/hudOverlay.js), same shape as
// preload.js's onLiveSyncStatus/onBackfillStatus — the overlay refreshes on
// its own polling interval, not in response to anything this renderer asks
// for. callback receives { maxSeats, seats: [{ name, isHero, seatOffset,
// stats }] }.
contextBridge.exposeInMainWorld('weplayHud', {
  onHudUpdate: (callback) => ipcRenderer.on('hud-update', (event, payload) => callback(payload)),
});
