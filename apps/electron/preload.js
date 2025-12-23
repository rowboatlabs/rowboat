const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('config', {
  apiBase: process.env.API_BASE,
});