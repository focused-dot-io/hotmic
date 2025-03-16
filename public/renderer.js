document.addEventListener('DOMContentLoaded', async () => {
  // DOM elements
  const apiKeyInput = document.getElementById('api-key');
  const saveApiKeyBtn = document.getElementById('save-api-key');
  const shortcutInput = document.getElementById('shortcut-input');
  const recordShortcutBtn = document.getElementById('record-shortcut-btn');
  const saveShortcutBtn = document.getElementById('save-shortcut-btn');
  const recordBtn = document.getElementById('record-btn');
  const statusElement = document.getElementById('status');
  const transcriptionResult = document.getElementById('transcription-result');
  const notification = document.getElementById('notification');
  
  // Audio recording variables
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimer = null;
  
  // Get saved API key
  const savedApiKey = await window.electronAPI.getApiKey();
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
    // Mask the API key
    setTimeout(() => {
      apiKeyInput.type = 'password';
    }, 500);
  }
  
  // Get and display the current global shortcut
  const currentShortcut = await window.electronAPI.getGlobalShortcut();
  shortcutInput.value = currentShortcut;
  
  // Set up listeners for events from main process
  const removeRecordingStatusListener = window.electronAPI.onRecordingStatus((recording) => {
    updateRecordingUI(recording);
  });
  
  const removeTranscriptionListener = window.electronAPI.onTranscriptionComplete((text) => {
    transcriptionResult.textContent = text;
    showNotification('Transcription complete and copied to clipboard', 'success');
  });
  
  const removeErrorListener = window.electronAPI.onError((message) => {
    showNotification(message, 'error');
  });

  const removeToggleRecordingListener = window.electronAPI.onToggleRecording(() => {
    toggleRecording();
  });
  
  const removeShortcutUpdatedListener = window.electronAPI.onShortcutUpdated((shortcut) => {
    shortcutInput.value = shortcut;
    showNotification(`Global shortcut updated to: ${shortcut}`, 'success');
  });

  // Shortcut recording variables
  let isRecordingShortcut = false;
  let recordedKeys = new Set();
  let keyOrder = [];
  
  // Event listeners for API key
  saveApiKeyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showNotification('Please enter an API key', 'error');
      return;
    }
    
    const success = await window.electronAPI.saveApiKey(apiKey);
    
    if (success) {
      showNotification('API key saved successfully', 'success');
    } else {
      showNotification('Failed to validate API key', 'error');
    }
  });
  
  // Event listeners for shortcut recording
  recordShortcutBtn.addEventListener('click', () => {
    toggleShortcutRecording();
  });
  
  saveShortcutBtn.addEventListener('click', async () => {
    const shortcut = shortcutInput.value.trim();
    if (!shortcut) {
      showNotification('Please record a shortcut first', 'error');
      return;
    }
    
    const success = await window.electronAPI.setGlobalShortcut(shortcut);
    
    if (success) {
      showNotification(`Global shortcut set to: ${shortcut}`, 'success');
    } else {
      showNotification('Failed to register shortcut. Try a different combination.', 'error');
    }
  });

  function toggleShortcutRecording() {
    isRecordingShortcut = !isRecordingShortcut;
    
    if (isRecordingShortcut) {
      // Start recording
      recordShortcutBtn.textContent = 'Stop';
      recordShortcutBtn.classList.add('recording');
      shortcutInput.value = 'Press keys...';
      recordedKeys.clear();
      keyOrder = [];
      
      // Add key listeners
      window.addEventListener('keydown', recordKeyDown);
      window.addEventListener('keyup', recordKeyUp);
    } else {
      // Stop recording
      recordShortcutBtn.textContent = 'Record';
      recordShortcutBtn.classList.remove('recording');
      window.removeEventListener('keydown', recordKeyDown);
      window.removeEventListener('keyup', recordKeyUp);
      
      // Format the shortcut
      formatShortcut();
    }
  }
  
  function recordKeyDown(event) {
    if (!isRecordingShortcut) return;
    
    event.preventDefault();
    
    const key = normalizeKey(event.key);
    if (!recordedKeys.has(key)) {
      recordedKeys.add(key);
      keyOrder.push(key);
      updateShortcutDisplay();
    }
  }
  
  function recordKeyUp(event) {
    // Nothing needed here for now
  }
  
  function normalizeKey(key) {
    // Normalize key names
    switch (key) {
      case ' ':
        return 'Space';
      case 'Control':
        return 'CommandOrControl';
      case 'Meta':
        return 'CommandOrControl';
      case 'ArrowUp':
        return 'Up';
      case 'ArrowDown':
        return 'Down';
      case 'ArrowLeft':
        return 'Left';
      case 'ArrowRight':
        return 'Right';
      default:
        // Capitalize first letter for single character keys
        if (key.length === 1) {
          return key.toUpperCase();
        }
        return key;
    }
  }
  
  function updateShortcutDisplay() {
    if (keyOrder.length === 0) {
      shortcutInput.value = 'Press keys...';
    } else {
      shortcutInput.value = keyOrder.join('+');
    }
  }
  
  function formatShortcut() {
    if (keyOrder.length === 0) {
      shortcutInput.value = '';
      return;
    }
    
    // Move modifier keys to the front
    const modifiers = ['CommandOrControl', 'Alt', 'Shift', 'Option'];
    const sortedKeys = [];
    
    // First add modifiers in correct order
    modifiers.forEach(mod => {
      if (recordedKeys.has(mod)) {
        sortedKeys.push(mod);
        recordedKeys.delete(mod);
      }
    });
    
    // Then add remaining keys in the order they were pressed
    keyOrder.forEach(key => {
      if (recordedKeys.has(key)) {
        sortedKeys.push(key);
      }
    });
    
    shortcutInput.value = sortedKeys.join('+');
  }
  
  // Audio recording
  recordBtn.addEventListener('click', toggleRecording);
  
  // Functions to handle recording
  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }
  
  async function startRecording() {
    const apiKey = await window.electronAPI.getApiKey();
    if (!apiKey) {
      showNotification('Please configure your Groq API key first', 'error');
      return;
    }
    
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create new media recorder with webm format
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm' // Explicitly use webm format
      });
      audioChunks = [];
      
      // Listen for data available events
      mediaRecorder.addEventListener('dataavailable', event => {
        audioChunks.push(event.data);
      });
      
      // Listen for stop events
      mediaRecorder.addEventListener('stop', processRecording);
      
      // Start recording - request data every second to ensure we get all audio
      mediaRecorder.start(1000);
      isRecording = true;
      updateRecordingUI(true);
      await window.electronAPI.updateRecordingState(true);
      
      // Auto-stop after 30 seconds
      recordingTimer = setTimeout(() => {
        if (isRecording) {
          stopRecording();
        }
      }, 30000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      showNotification(`Could not access microphone: ${error.message}`, 'error');
    }
  }
  
  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    
    // Clear auto-stop timer
    if (recordingTimer) {
      clearTimeout(recordingTimer);
      recordingTimer = null;
    }
    
    // Stop recording
    mediaRecorder.stop();
    isRecording = false;
    updateRecordingUI(false);
    window.electronAPI.updateRecordingState(false);
    
    // Stop all tracks on the stream
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }
  
  async function processRecording() {
    try {
      showNotification('Processing audio...', '');
      
      // Create an audio blob from the recorded chunks
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      
      // Convert blob to base64
      const base64Audio = await blobToBase64(audioBlob);
      
      // Remove the data URI prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64Audio.split(',')[1];
      
      // Send to main process for transcription
      await window.electronAPI.transcribeAudio(base64Data);
      
    } catch (error) {
      console.error('Error processing recording:', error);
      showNotification(`Error processing recording: ${error.message}`, 'error');
    }
  }
  
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  function updateRecordingUI(recording) {
    if (recording) {
      recordBtn.textContent = 'Stop Recording';
      recordBtn.style.backgroundColor = '#ff3b30';
      statusElement.textContent = 'Recording...';
      statusElement.classList.add('recording');
    } else {
      recordBtn.textContent = 'Start Recording';
      recordBtn.style.backgroundColor = '#0071e3';
      statusElement.textContent = 'Not recording';
      statusElement.classList.remove('recording');
    }
  }
  
  // Helper functions
  function showNotification(message, type = '') {
    notification.textContent = message;
    notification.className = ''; // Reset classes
    
    if (type) {
      notification.classList.add(type);
    }
    
    notification.classList.remove('hidden');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      notification.classList.add('hidden');
    }, 3000);
  }
  
  // Clean up event listeners when window is closed
  window.addEventListener('beforeunload', () => {
    // Remove IPC event listeners
    removeRecordingStatusListener();
    removeTranscriptionListener();
    removeErrorListener();
    removeToggleRecordingListener();
    removeShortcutUpdatedListener();
    
    // Remove DOM event listeners if recording shortcut
    if (isRecordingShortcut) {
      window.removeEventListener('keydown', recordKeyDown);
      window.removeEventListener('keyup', recordKeyUp);
    }
    
    // Stop recording if active
    if (isRecording && mediaRecorder) {
      mediaRecorder.stop();
      if (mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    }
  });
});