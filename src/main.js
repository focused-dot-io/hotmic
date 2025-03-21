/**
 * HotMic Main Process
 *
 * This file handles the main Electron process:
 * - Window management
 * - Recording and transcription
 * - Communication with renderer processes
 * - Global shortcuts
 * - Tray icon
 *
 * CROSS-PLATFORM NOTES:
 * This application supports both macOS and Windows, but some features are macOS-specific:
 * - Dock icon management (show/hide in dock)
 * - macOS-specific window styling (titleBarStyle, vibrancy, visualEffectState)
 *
 * All macOS-specific code is marked with "MACOS SPECIFIC" comments and guarded
 * by the isMacOS constant (process.platform === 'darwin').
 */

import { app, BrowserWindow, ipcMain, globalShortcut, Menu, Tray, clipboard, nativeImage, screen, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import FormData from 'form-data';
import fs from 'node:fs';
import os from 'node:os';
import Store from 'electron-store';
// Import fetch API for Node.js (available in modern Node.js)
import { fetch } from 'undici';

// Fix __dirname and __filename which aren't available in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Platform Detection
 */
// Detect if we're running on macOS
const isMacOS = process.platform === 'darwin';

/**
 * Application Configuration
 */
// Initialize persistent store for app settings
const store = new Store();

// Define temp directory for audio files
const tempDir = path.join(os.tmpdir(), 'hot-mic');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Default prompt for email formatting
const DEFAULT_PROMPT = 'Please format this transcript as a professional email with a greeting and sign-off. Make it concise and clear while maintaining the key information.';

/**
 * Application State
 */
let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isRecording = false;
let audioData = [];

/**
 * History Management
 */
function cleanupOldHistory() {
  // Skip if history is disabled
  if (!store.get('historyEnabled', true)) return [];

  const history = store.get('history', []);
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const newHistory = history.filter(item => item.timestamp > thirtyDaysAgo);
  store.set('history', newHistory);
  return newHistory;
}

function addToHistory(rawText, processedText) {
  // Skip if history is disabled
  if (!store.get('historyEnabled', true)) return;

  const history = store.get('history', []);

  // Encrypt the transcript data if encryption is available
  let encryptedRawText = rawText;
  let encryptedProcessedText = processedText;

  if (safeStorage.isEncryptionAvailable()) {
    try {
      encryptedRawText = safeStorage.encryptString(rawText).toString('base64');
      encryptedProcessedText = safeStorage.encryptString(processedText).toString('base64');
    } catch (error) {
      console.error('Error encrypting history data:', error);
    }
  }

  history.unshift({
    timestamp: Date.now(),
    rawText: encryptedRawText,
    processedText: encryptedProcessedText,
    encrypted: safeStorage.isEncryptionAvailable()
  });

  store.set('history', history);

  // Notify renderer of history update
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated');
  }

  cleanupOldHistory();
}

function clearHistory() {
  store.set('history', []);
  // Notify renderer of history update
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated');
  }
  return true;
}

function getHistory() {
  const history = cleanupOldHistory();

  // If encryption is available, decrypt the history items
  if (safeStorage.isEncryptionAvailable()) {
    return history.map(item => {
      try {
        if (item.encrypted) {
          return {
            timestamp: item.timestamp,
            rawText: safeStorage.decryptString(Buffer.from(item.rawText, 'base64')),
            processedText: safeStorage.decryptString(Buffer.from(item.processedText, 'base64'))
          };
        }
        return item;
      } catch (error) {
        console.error('Error decrypting history item:', error);
        return {
          timestamp: item.timestamp,
          rawText: 'Error: Could not decrypt transcript',
          processedText: 'Error: Could not decrypt transcript'
        };
      }
    });
  }

  return history;
}

/**
 * Post-Processing with Groq
 */
async function postProcessTranscript(text) {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    throw new Error('API key not set');
  }

  const promptSettings = store.get('promptSettings', {
    enabled: false,
    prompt: DEFAULT_PROMPT
  });

  if (!promptSettings.enabled) {
    return text;
  }

  try {
    updateTranscriptionProgress('processing', 'Post-processing with Groq...');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: promptSettings.prompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.7,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${response.statusText}${errorData.error ? ' - ' + errorData.error.message : ''}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    updateTranscriptionProgress('error', 'Post-processing failed, using raw transcript');
    return text;
  }
}

/**
 * API and Transcription
 */
async function transcribeAudio(audioBuffer) {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    throw new Error('API key not set. Please configure in settings.');
  }

  let tempFile = null;
  try {
    updateTranscriptionProgress('start', 'Starting transcription...');

    // Save audio to temp file
    tempFile = path.join(tempDir, `recording-${Date.now()}.wav`);
    fs.writeFileSync(tempFile, Buffer.from(audioBuffer));

    updateTranscriptionProgress('api', 'Sending to Groq API...');

    // Send to Groq API for transcription
    const rawTranscript = await sendToGroqAPI(apiKey, tempFile);

    // If we get here and rawTranscript is empty, don't proceed
    if (!rawTranscript?.trim()) {
      updateTranscriptionProgress('error', 'No speech detected');
      setTimeout(() => closeOverlayWindow(), 2000);
      return;
    }

    // Post-process with Groq if enabled
    updateTranscriptionProgress('processing', 'Post-processing transcript...');
    const processedTranscript = await postProcessTranscript(rawTranscript);

    // Add to history only if we have valid transcripts
    if (processedTranscript?.trim()) {
      addToHistory(rawTranscript, processedTranscript);
      // Copy processed version to clipboard
      updateTranscriptionProgress('complete', 'Processing complete');
      clipboard.writeText(processedTranscript);
    } else {
      updateTranscriptionProgress('error', 'Failed to process transcript');
    }

    // Close overlay after a delay
    setTimeout(() => closeOverlayWindow(), 1500);

    return processedTranscript;
  } catch (error) {
    updateTranscriptionProgress('error', `Error: ${error.message}`);
    // Close overlay after a delay
    setTimeout(() => closeOverlayWindow(), 2000);
    throw error;
  } finally {
    // Clean up temp file
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

function updateTranscriptionProgress(step, message) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('transcription-progress', { step, message });
  }
}

async function sendToGroqAPI(apiKey, audioFilePath) {
  // Create form data for API request
  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioFilePath));
  formData.append('model', 'whisper-large-v3');

  // Send request to Groq API
  const response = await new Promise((resolve, reject) => {
    const formHeaders = formData.getHeaders();

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formHeaders
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
        updateTranscriptionProgress('receiving', 'Receiving transcription...');
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, data });
        } else {
          console.error('API Error Response:', {
            statusCode: res.statusCode,
            data: data
          });
          resolve({ ok: false, statusCode: res.statusCode, data });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request Error:', error);
      reject(error);
    });

    formData.pipe(req);
  });

  if (!response.ok) {
    console.error('API Error:', response.data);
    throw new Error(`API error: ${response.data}`);
  }

  try {
    const result = JSON.parse(response.data);
    console.log('API Response:', result);

    if (!result || typeof result !== 'object') {
      throw new Error('Invalid API response format');
    }

    const transcript = result.text?.trim();
    console.log('Extracted transcript:', transcript);

    // If no transcript or empty transcript, throw error
    if (!transcript) {
      throw new Error('No speech detected in audio');
    }

    return transcript;
  } catch (error) {
    console.error('Error processing API response:', error);
    throw new Error(`Failed to process API response: ${error.message}`);
  }
}

/**
 * Tray Management
 */
function createTray() {
  try {
    // Clean up existing tray if it exists
    if (tray) {
      tray.destroy();
      tray = null;
    }

    // Create native image from file
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, '../public/icons/32x32.png'));

    // Create tray with template image
    tray = new Tray(trayIcon);

    // MACOS SPECIFIC: Check dock visibility
    // This is only available on macOS
    const showingInDock = isMacOS && app.dock ? !app.dock.isVisible() : false;

    // Create context menu items
    const menuItems = [
      {
        label: 'Start/Stop Recording',
        click: toggleRecording
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      { type: 'separator' },
    ];

    // MACOS SPECIFIC: Add dock toggle option
    // Only available on macOS
    if (isMacOS) {
      menuItems.push({
        label: 'Show in Dock',
        type: 'checkbox',
        checked: showingInDock,
        click: () => toggleDockVisibility()
      });
      menuItems.push({ type: 'separator' });
    }

    // Add quit option
    menuItems.push({
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    });

    const contextMenu = Menu.buildFromTemplate(menuItems);

    tray.setToolTip('HotMic');
    tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error('Error creating tray:', error);
  }
}

/**
 * Toggle dock visibility (MACOS SPECIFIC)
 * This function only works on macOS and manages the app's visibility in the dock
 */
function toggleDockVisibility() {
  // Exit early if not on macOS
  if (!isMacOS || !app.dock) return;

  if (app.dock.isVisible()) {
    app.dock.hide();
  } else {
    app.dock.show();
  }

  // Update the tray menu after toggling
  if (tray) {
    // MACOS SPECIFIC: Check dock visibility
    const showingInDock = app.dock ? !app.dock.isVisible() : false;

    // Create context menu items
    const menuItems = [
      {
        label: 'Start/Stop Recording',
        click: toggleRecording
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      { type: 'separator' },
    ];

    // MACOS SPECIFIC: Add dock toggle option
    if (isMacOS) {
      menuItems.push({
        label: 'Show in Dock',
        type: 'checkbox',
        checked: showingInDock,
        click: () => toggleDockVisibility()
      });
      menuItems.push({ type: 'separator' });
    }

    // Add quit option
    menuItems.push({
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    });

    const contextMenu = Menu.buildFromTemplate(menuItems);
    tray.setContextMenu(contextMenu);
  }
}

/**
 * User Input Handling
 */
function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

/**
 * IPC Handlers
 */
function setupIPCHandlers() {
  // Receive audio data from renderer
  ipcMain.handle('audio-data', async (event, audioBuffer) => {
    try {
      const transcription = await transcribeAudio(audioBuffer);
      return { success: true, transcription };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // API key management
  ipcMain.handle('set-api-key', (event, key) => {
    store.set('apiKey', key);
    return true;
  });

  ipcMain.handle('get-api-key', () => {
    return store.get('apiKey') || '';
  });

  // Shortcut management
  ipcMain.handle('set-shortcut', (event, shortcut) => {
    try {
      // Unregister existing shortcut
      globalShortcut.unregisterAll();

      // Register new shortcut
      globalShortcut.register(shortcut, toggleRecording);

      // Save to store
      store.set('shortcut', shortcut);
      return true;
    } catch (error) {
      console.error('Error setting shortcut:', error);
      return false;
    }
  });

  ipcMain.handle('get-shortcut', () => {
    // Use platform-specific default shortcuts
    const defaultShortcut = isMacOS ? 'Command+Shift+Space' : 'Ctrl+Shift+Space';
    return store.get('shortcut') || defaultShortcut;
  });

  // Prompt settings
  ipcMain.handle('get-prompt-settings', () => {
    return store.get('promptSettings', {
      enabled: false,
      prompt: DEFAULT_PROMPT
    });
  });

  ipcMain.handle('set-prompt-settings', (event, settings) => {
    store.set('promptSettings', settings);
    return true;
  });

  // History management
  ipcMain.handle('get-history', () => {
    return getHistory();
  });

  ipcMain.handle('clear-history', () => {
    return clearHistory();
  });

  ipcMain.handle('is-history-encrypted', () => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle('get-history-settings', () => {
    return {
      enabled: store.get('historyEnabled', true),
      encrypted: safeStorage.isEncryptionAvailable()
    };
  });

  ipcMain.handle('set-history-enabled', (event, enabled) => {
    store.set('historyEnabled', enabled);
    return true;
  });

  // Settings window management
  ipcMain.handle('open-settings', () => {
    // Close overlay window if open and cancel any ongoing transcription
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('cancel-transcription');
      closeOverlayWindow();
    }

    // Stop recording if active
    if (isRecording) {
      isRecording = false;
      audioData = [];
    }

    // Show settings window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
    return true;
  });

  // Audio level updates from renderer
  ipcMain.handle('audio-level', (event, level) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('audio-level', level);
    }
    return true;
  });
}

/**
 * App Lifecycle Management
 */
async function initialize() {
  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Set up IPC handlers
  setupIPCHandlers();

  // When app is ready
  await app.whenReady();

  try {
    // MACOS SPECIFIC: Dock visibility management
    // Hide dock icon if not configured to show (macOS only)
    if (isMacOS && app.dock && !store.get('showInDock', false)) {
      app.dock.hide();
    }

    // Create main window first
    createMainWindow();

    // Create tray icon
    createTray();

    // Register global shortcut
    const shortcut = store.get('shortcut') || 'Command+Shift+Space';
    globalShortcut.register(shortcut, toggleRecording);

    // Handle app activation
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    });
  } catch (error) {
    console.error('Error initializing app:', error);
  }


  // Prevent default behavior of closing app when all windows are closed
  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  // Clean up when app is about to quit
  app.on('will-quit', () => {
    app.isQuitting = true;

    // Unregister shortcuts
    globalShortcut.unregisterAll();

    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }

    // Close windows
    closeOverlayWindow();
  });
}

/**
 * Window Management
 */
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    skipTaskbar: false,
    title: 'HotMic',
    // MACOS SPECIFIC: titleBarStyle is only used on macOS
    titleBarStyle: isMacOS ? 'hiddenInset' : 'default',
    backgroundColor: '#00000000'
  });

  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  // Show in App Switcher when window is shown
  mainWindow.on('show', () => {
    // MACOS SPECIFIC: Show in dock when window is shown
    // On macOS, we show the app in the dock when the settings window is open
    if (isMacOS && app.dock && store.get('showInDock', false)) {
      app.dock.show();
    }
  });

  // Remove from App Switcher when window is hidden
  mainWindow.on('hide', () => {
    // MACOS SPECIFIC: Hide dock when window is hidden
    // On macOS, we hide the dock icon when the window is hidden (unless configured to show)
    if (isMacOS && app.dock && !store.get('showInDock', false)) {
      app.dock.hide();
    }
  });

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.once('ready-to-show', () => {
    // Only show on first launch or if API key isn't set
    if (!store.get('apiKey')) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  // Close existing overlay if any
  closeOverlayWindow();

  // Get screen dimensions to center the overlay
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 340,
    height: 340,
    x: Math.floor(width / 2 - 150),
    y: Math.floor(height / 2 - 150),
    frame: false,
    // Note: transparent works on both platforms but has better results on macOS
    transparent: true,
    backgroundColor: '#00000000',
    opacity: 1.0,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    vibrancy: isMacOS ? null : undefined,
    visualEffectState: isMacOS ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  overlayWindow.loadFile(path.join(__dirname, '../public/overlay.html'));

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
  });
}

function closeOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

/**
 * Recording Management
 */
function startRecording() {
  if (isRecording) return;

  isRecording = true;
  audioData = [];

  // Show overlay window
  createOverlayWindow();

  // Start recording in overlay
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('start-recording');
  }
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;

  // Tell overlay to stop recording
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('stop-recording');
  }
}

// Start the app using a top-level await
(async () => {
  await initialize();
})();