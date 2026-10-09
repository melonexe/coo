const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  loadHosts: () => ipcRenderer.invoke('hosts:load'),
  saveHosts: hosts => ipcRenderer.invoke('hosts:save', hosts),
  pickFile: () => ipcRenderer.invoke('dialog:openFile'),
  createSession: cfg => ipcRenderer.invoke('session:create', cfg),
  cancelConnect: connectId => ipcRenderer.send('session:cancelConnect', connectId),
  closeSession: id => ipcRenderer.invoke('session:close', id),
  netList: () => ipcRenderer.invoke('net:list'),
  netApply: cfg => ipcRenderer.invoke('net:apply', cfg),
  netLoadPresets: () => ipcRenderer.invoke('net:loadPresets'),
  netSavePresets: presets => ipcRenderer.invoke('net:savePresets', presets),
  input: (id, data) => ipcRenderer.send('session:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', { id, cols, rows }),
  onData: cb => ipcRenderer.on('session:data', (e, msg) => cb(msg)),
  onStatus: cb => ipcRenderer.on('session:status', (e, msg) => cb(msg)),
  onLog: cb => ipcRenderer.on('session:log', (e, msg) => cb(msg)),

  openExternal: url => ipcRenderer.send('shell:openExternal', url),

  logStart: opts => ipcRenderer.invoke('log:start', opts),
  logStop: id => ipcRenderer.invoke('log:stop', id),

  saveTextFile: opts => ipcRenderer.invoke('file:saveText', opts),
  openTextFile: opts => ipcRenderer.invoke('file:openText', opts),

  loadSnippets: () => ipcRenderer.invoke('snippets:load'),
  saveSnippets: snippets => ipcRenderer.invoke('snippets:save', snippets),

  sftpList: args => ipcRenderer.invoke('sftp:list', args),
  sftpMkdir: args => ipcRenderer.invoke('sftp:mkdir', args),
  sftpRename: args => ipcRenderer.invoke('sftp:rename', args),
  sftpDelete: args => ipcRenderer.invoke('sftp:delete', args),
  sftpDownload: args => ipcRenderer.invoke('sftp:download', args),
  sftpUpload: args => ipcRenderer.invoke('sftp:upload', args),
  sftpPreview: args => ipcRenderer.invoke('sftp:preview', args),
  sftpDownloadDir: args => ipcRenderer.invoke('sftp:downloadDir', args),
  sftpCancel: xferId => ipcRenderer.send('sftp:cancel', xferId),
  onSftpProgress: cb => ipcRenderer.on('sftp:progress', (e, msg) => cb(msg)),
  pathForFile: file => webUtils.getPathForFile(file)
});
