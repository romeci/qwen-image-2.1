const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qwen', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, cb) => ipcRenderer.on(channel, (_event, data) => cb(data)),
});
