'use strict'
const { contextBridge, ipcRenderer } = require('electron')
// Same invocation/event contract as the production preload, without auth or telemetry initialization.
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: { invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args) }
})
contextBridge.exposeInMainWorld('api', {
  on(channel, callback) {
    const listener = (_event, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return listener
  },
  removeListener(channel, listener) {
    ipcRenderer.removeListener(channel, listener)
  }
})
