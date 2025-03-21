/**
 * Preload Script for Whisper Transcriber
 *
 * This script securely exposes main process functionality to the renderer processes
 * through the contextBridge API, following the principle of least privilege.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Create a safe API wrapper that exposes only necessary functions
 * to the renderer process through contextBridge
 */
contextBridge.exposeInMainWorld('api', {
  // Settings management
  getApiProvider: () => ipcRenderer.invoke('get-api-provider'),
  setApiProvider: (provider) => ipcRenderer.invoke('set-api-provider', provider),

  // Groq API
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getGroqBaseUrl: () => ipcRenderer.invoke('get-groq-base-url'),
  setGroqBaseUrl: (url) => ipcRenderer.invoke('set-groq-base-url', url),
  getGroqModel: () => ipcRenderer.invoke('get-groq-model'),
  setGroqModel: (model) => ipcRenderer.invoke('set-groq-model', model),

  // OpenAI API
  getOpenaiApiKey: () => ipcRenderer.invoke('get-openai-api-key'),
  setOpenaiApiKey: (key) => ipcRenderer.invoke('set-openai-api-key', key),
  getOpenaiBaseUrl: () => ipcRenderer.invoke('get-openai-base-url'),
  setOpenaiBaseUrl: (url) => ipcRenderer.invoke('set-openai-base-url', url),
  getOpenaiModel: () => ipcRenderer.invoke('get-openai-model'),
  setOpenaiModel: (model) => ipcRenderer.invoke('set-openai-model', model),

  getShortcut: () => ipcRenderer.invoke('get-shortcut'),
  setShortcut: (shortcut) => ipcRenderer.invoke('set-shortcut', shortcut),
  getPromptSettings: () => ipcRenderer.invoke('get-prompt-settings'),
  setPromptSettings: (settings) => ipcRenderer.invoke('set-prompt-settings', settings),
  getHistory: () => ipcRenderer.invoke('get-history'),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // History management
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  isHistoryEncrypted: () => ipcRenderer.invoke('is-history-encrypted'),
  getHistorySettings: () => ipcRenderer.invoke('get-history-settings'),
  setHistoryEnabled: (enabled) => ipcRenderer.invoke('set-history-enabled', enabled),

  // Recording functionality
  sendAudioData: (buffer) => ipcRenderer.invoke('audio-data', buffer),
  sendAudioLevel: (level) => ipcRenderer.invoke('audio-level', level),

  // Event listeners (with proper cleanup)
  onStartRecording: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('start-recording', listener);
    return () => ipcRenderer.removeListener('start-recording', listener);
  },

  onStopRecording: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('stop-recording', listener);
    return () => ipcRenderer.removeListener('stop-recording', listener);
  },

  onAudioLevel: (callback) => {
    const listener = (_, level) => callback(level);
    ipcRenderer.on('audio-level', listener);
    return () => ipcRenderer.removeListener('audio-level', listener);
  },

  onTranscriptionProgress: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('transcription-progress', listener);
    return () => ipcRenderer.removeListener('transcription-progress', listener);
  },

  onShortcutError: (callback) => {
    const listener = (_, message) => callback(message);
    ipcRenderer.on('shortcut-error', listener);
    return () => ipcRenderer.removeListener('shortcut-error', listener);
  },

  onCancelTranscription: (callback) => {
    ipcRenderer.on('cancel-transcription', callback);
    return () => ipcRenderer.removeListener('cancel-transcription', callback);
  },

  // History methods
  onHistoryUpdate: (callback) => ipcRenderer.on('history-updated', callback)
});
