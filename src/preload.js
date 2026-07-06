const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  loadHosts: () => ipcRenderer.invoke('hosts:load'),
  saveHosts: hosts => ipcRenderer.invoke('hosts:save', hosts),
  pickFile: () => ipcRenderer.invoke('dialog:openFile'),
  createSession: cfg => ipcRenderer.invoke('session:create', cfg),
  cancelConnect: connectId => ipcRenderer.send('session:cancelConnect', connectId),
  closeSession: id => ipcRenderer.invoke('session:close', id),
  input: (id, data) => ipcRenderer.send('session:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', { id, cols, rows }),
  onData: cb => ipcRenderer.on('session:data', (e, msg) => cb(msg)),
  onStatus: cb => ipcRenderer.on('session:status', (e, msg) => cb(msg)),
  onLog: cb => ipcRenderer.on('session:log', (e, msg) => cb(msg))
});
