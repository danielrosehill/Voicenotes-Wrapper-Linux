const { app, BrowserWindow, session, Menu, shell, Tray, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const AudioMonitor = require('./audio-monitor');

// Disable sandbox to avoid permission issues on Linux
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--disable-setuid-sandbox');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;
let tray = null;
let recordingState = 'stopped'; // 'stopped', 'recording', 'paused'
let currentMicrophone = null;
let audioMonitor = null;
let systemAudioInfo = { name: 'System Audio Input', level: 0 };

// Configurable keyboard shortcuts (default values - using safe combinations)
let recordingShortcuts = {
  record: 'CommandOrControl+Alt+R',
  pause: 'CommandOrControl+Alt+P', 
  stop: 'CommandOrControl+Alt+S'
};

// Load custom shortcuts from configuration file
function loadShortcutsConfig() {
  try {
    const configPath = path.join(__dirname, 'recording-shortcuts.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      if (config.shortcuts) {
        recordingShortcuts = { ...recordingShortcuts, ...config.shortcuts };
        console.log('Voice Notes Wrapper: Loaded custom shortcuts from config file');
      }
    }
  } catch (error) {
    console.log('Voice Notes Wrapper: Could not load shortcuts config, using defaults:', error.message);
  }
}

// Function to update keyboard shortcuts (for Bluetooth remote configuration)
function updateRecordingShortcuts(newShortcuts) {
  // Unregister old shortcuts
  globalShortcut.unregister(recordingShortcuts.record);
  globalShortcut.unregister(recordingShortcuts.pause);
  globalShortcut.unregister(recordingShortcuts.stop);
  
  // Update shortcuts
  if (newShortcuts.record) recordingShortcuts.record = newShortcuts.record;
  if (newShortcuts.pause) recordingShortcuts.pause = newShortcuts.pause;
  if (newShortcuts.stop) recordingShortcuts.stop = newShortcuts.stop;
  
  // Register new shortcuts
  globalShortcut.register(recordingShortcuts.record, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.record} key pressed - Start Recording`);
    startRecording();
  });

  globalShortcut.register(recordingShortcuts.pause, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.pause} key pressed - Pause Recording`);
    pauseRecording();
  });

  globalShortcut.register(recordingShortcuts.stop, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.stop} key pressed - Stop Recording`);
    stopRecording();
  });
  
  console.log('Voice Notes Wrapper: Updated shortcuts:');
  console.log(`- ${recordingShortcuts.record}: Start Recording`);
  console.log(`- ${recordingShortcuts.pause}: Pause Recording`);
  console.log(`- ${recordingShortcuts.stop}: Stop Recording`);
  
  // Update tray menu to reflect new shortcuts
  updateTrayMenu(currentMicrophone);
}

// URL for Voice Notes app
const voiceNotesUrl = 'https://voicenotes.com/app';

// Path for storing persistent data
const userDataPath = path.join(app.getPath('userData'), 'VoiceNotes');

// Ensure the user data directory exists
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Voice Notes',
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: {
      nodeIntegration: false, // For security reasons
      contextIsolation: true, // For security reasons
      enableRemoteModule: false, // For security reasons
      sandbox: false, // Disable sandbox to avoid permission issues
      preload: path.join(__dirname, 'preload.js'),
      // Enable microphone access
      permissions: {
        microphone: true,
        media: true
      }
    }
  });

  // Load the Voice Notes URL
  mainWindow.loadURL(voiceNotesUrl);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow navigation to voicenotes.com domain
    if (url.startsWith('https://voicenotes.com')) {
      return { action: 'allow' };
    }
    // Open other links in external browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window being closed - minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Voice Notes Wrapper',
          click: async () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              title: 'About Voice Notes Wrapper',
              message: 'Voice Notes Wrapper v1.0.0\nCreated for Daniel Rosehill',
              detail: 'A desktop wrapper for the Voice Notes web application.',
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Visit Voice Notes Website',
          click: async () => {
            await shell.openExternal('https://voicenotes.com');
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  // Create tray icon - handle both development and packaged environments with multiple fallbacks
  let iconPath;
  const possiblePaths = [];
  
  if (app.isPackaged) {
    // In packaged app, try multiple possible locations
    possiblePaths.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.png'),
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(__dirname, 'build', 'icon.png'),
      path.join(__dirname, '..', 'build', 'icon.png')
    );
  } else {
    // In development
    possiblePaths.push(
      path.join(__dirname, 'build', 'icon.png'),
      path.join(__dirname, 'assets', 'icon.png'),
      path.join(__dirname, 'icon.png')
    );
  }
  
  // Find the first existing icon path
  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      iconPath = testPath;
      console.log(`Voice Notes Wrapper: Using tray icon from: ${iconPath}`);
      break;
    }
  }
  
  if (!iconPath) {
    console.log('Voice Notes Wrapper: No tray icon found, trying to create a simple fallback');
    // Create a simple fallback icon if none found
    try {
      // Use a built-in Electron icon or create a simple one
      iconPath = path.join(__dirname, 'build', 'icon.png');
    } catch (error) {
      console.log('Voice Notes Wrapper: Could not create fallback icon:', error.message);
      console.log('Voice Notes Wrapper: Continuing without tray (app will still work)');
      return;
    }
  }
  
  try {
    tray = new Tray(iconPath);
    console.log('Voice Notes Wrapper: Tray icon created successfully');
    
    // Set initial tooltip
    tray.setToolTip('Voice Notes - Right-click for options');
    
    // Create initial context menu
    updateTrayMenu();
    
    // Double-click to show/hide window
    tray.on('double-click', () => {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
    // Single click to show window (Linux behavior)
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
    
  } catch (error) {
    console.log('Voice Notes Wrapper: Could not create tray icon:', error.message);
    console.log('Voice Notes Wrapper: Possible causes:');
    console.log('- Missing system tray support');
    console.log('- Invalid icon file');
    console.log('- Desktop environment issues');
    console.log('Voice Notes Wrapper: Continuing without tray (app will still work)');
    tray = null;
    return;
  }
}

// Enhanced recording control functions
function startRecording() {
  if (!mainWindow || recordingState === 'recording') return;
  
  console.log('Voice Notes Wrapper: Starting recording...');
  
  mainWindow.webContents.executeJavaScript(`
    if (window.voiceNotesWrapper && window.voiceNotesWrapper.startRecording) {
      return window.voiceNotesWrapper.startRecording();
    } else {
      // Fallback: look for record button
      const recordButton = document.querySelector('[data-testid="record-button"], button[aria-label*="record" i], button[title*="record" i], .record-button, #record-button');
      if (recordButton && !recordButton.disabled) {
        recordButton.click();
        console.log('Voice Notes Wrapper: Record button clicked (fallback)');
        return { success: true, action: 'record' };
      }
      return { success: false, error: 'Record button not found' };
    }
  `).then((result) => {
    if (result && result.success) {
      recordingState = 'recording';
      updateTrayMenu(currentMicrophone);
      showNotification('Recording started', '🔴');
    } else {
      console.log('Voice Notes Wrapper: Failed to start recording:', result?.error);
      showNotification('Could not start recording. Please ensure Voice Notes is loaded.', '❌');
    }
  }).catch((error) => {
    console.error('Voice Notes Wrapper: Error starting recording:', error);
  });
}

function pauseRecording() {
  if (!mainWindow || recordingState !== 'recording') return;
  
  console.log('Voice Notes Wrapper: Pausing recording...');
  
  mainWindow.webContents.executeJavaScript(`
    if (window.voiceNotesWrapper && window.voiceNotesWrapper.pauseRecording) {
      return window.voiceNotesWrapper.pauseRecording();
    } else {
      // Fallback: look for pause button
      const pauseButton = document.querySelector('[data-testid="pause-button"], button[aria-label*="pause" i], button[title*="pause" i], .pause-button, #pause-button');
      if (pauseButton && !pauseButton.disabled) {
        pauseButton.click();
        console.log('Voice Notes Wrapper: Pause button clicked (fallback)');
        return { success: true, action: 'pause' };
      }
      return { success: false, error: 'Pause button not found' };
    }
  `).then((result) => {
    if (result && result.success) {
      recordingState = 'paused';
      updateTrayMenu(currentMicrophone);
      showNotification('Recording paused', '⏸️');
    } else {
      console.log('Voice Notes Wrapper: Failed to pause recording:', result?.error);
      showNotification('Could not pause recording.', '❌');
    }
  }).catch((error) => {
    console.error('Voice Notes Wrapper: Error pausing recording:', error);
  });
}

function stopRecording() {
  if (!mainWindow || recordingState === 'stopped') return;
  
  console.log('Voice Notes Wrapper: Stopping recording...');
  
  mainWindow.webContents.executeJavaScript(`
    if (window.voiceNotesWrapper && window.voiceNotesWrapper.stopRecording) {
      return window.voiceNotesWrapper.stopRecording();
    } else {
      // Fallback: look for stop button
      const stopButton = document.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i], button[title*="stop" i], .stop-button, #stop-button');
      if (stopButton && !stopButton.disabled) {
        stopButton.click();
        console.log('Voice Notes Wrapper: Stop button clicked (fallback)');
        return { success: true, action: 'stop' };
      }
      return { success: false, error: 'Stop button not found' };
    }
  `).then((result) => {
    if (result && result.success) {
      recordingState = 'stopped';
      updateTrayMenu(currentMicrophone);
      showNotification('Recording stopped', '⏹️');
    } else {
      console.log('Voice Notes Wrapper: Failed to stop recording:', result?.error);
      showNotification('Could not stop recording.', '❌');
    }
  }).catch((error) => {
    console.error('Voice Notes Wrapper: Error stopping recording:', error);
  });
}

// Helper function for notifications
function showNotification(message, icon = '🎤') {
  if (tray) {
    tray.displayBalloon({
      title: 'Voice Notes',
      content: `${icon} ${message}`
    });
  }
}

// Legacy function for backward compatibility
function toggleRecording() {
  if (recordingState === 'stopped') {
    startRecording();
  } else {
    stopRecording();
  }
}

// Function to refresh the Voice Notes page
function refreshVoiceNotes() {
  if (!mainWindow) return;
  
  console.log('Voice Notes Wrapper: Refreshing Voice Notes page...');
  mainWindow.webContents.reload();
  
  showNotification('Voice Notes refreshed', '🔄');
}

function updateTrayMenu(microphoneInfo = null) {
  if (!tray) return;
  
  // Get recording state display
  const stateEmoji = {
    'stopped': '⏹️',
    'recording': '🔴',
    'paused': '⏸️'
  };
  
  const menuItems = [
    {
      label: 'Show Voice Notes',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '🔄 Refresh (Ctrl+Alt+F5)',
      click: () => refreshVoiceNotes()
    },
    { type: 'separator' },
    {
      label: `${stateEmoji[recordingState]} Status: ${recordingState.charAt(0).toUpperCase() + recordingState.slice(1)}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: `🔴 Record (F10)`,
      enabled: recordingState === 'stopped',
      click: () => startRecording()
    },
    {
      label: `⏸️ Pause (F11)`,
      enabled: recordingState === 'recording',
      click: () => pauseRecording()
    },
    {
      label: `⏹️ Stop (F12)`,
      enabled: recordingState !== 'stopped',
      click: () => stopRecording()
    }
  ];

  // Add microphone info if available
  if (microphoneInfo) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: `🎤 Web: ${microphoneInfo}`,
      enabled: false // Make it non-clickable, just informational
    });
  }
  
  // Add system audio info
  menuItems.push({ type: 'separator' });
  const levelPercent = Math.round(systemAudioInfo.level * 100);
  const levelBar = '█'.repeat(Math.floor(levelPercent / 10)) + '░'.repeat(10 - Math.floor(levelPercent / 10));
  menuItems.push({
    label: `🔊 System: ${systemAudioInfo.name}`,
    enabled: false
  });
  menuItems.push({
    label: `📊 Level: ${levelPercent}% [${levelBar}]`,
    enabled: false
  });

  menuItems.push(
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  );
  
  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

// IPC handler for microphone info updates
ipcMain.on('update-microphone-info', (event, micInfo) => {
  currentMicrophone = micInfo;
  console.log('Voice Notes Wrapper: Microphone updated:', micInfo);
  updateTrayMenu(currentMicrophone);
});

// Send system audio info to renderer process
ipcMain.handle('get-system-audio-info', async () => {
  if (audioMonitor) {
    try {
      const deviceInfo = await audioMonitor.getCurrentDevice();
      return deviceInfo;
    } catch (error) {
      console.log('Voice Notes Wrapper: Error getting system audio info:', error.message);
      return { name: 'System Audio Input', level: 0 };
    }
  }
  return systemAudioInfo;
});

// IPC handler for muting/unmuting microphone
ipcMain.handle('toggle-microphone-mute', async () => {
  if (audioMonitor) {
    try {
      const result = await audioMonitor.toggleMute();
      return result;
    } catch (error) {
      console.log('Voice Notes Wrapper: Error toggling microphone mute:', error.message);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Audio monitor not available' };
});

// IPC handler for getting microphone mute status
ipcMain.handle('get-microphone-mute-status', async () => {
  if (audioMonitor) {
    try {
      const result = await audioMonitor.getMuteStatus();
      return result;
    } catch (error) {
      console.log('Voice Notes Wrapper: Error getting microphone mute status:', error.message);
      return { isMuted: false, error: error.message };
    }
  }
  return { isMuted: false, error: 'Audio monitor not available' };
});

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Load custom shortcuts configuration
  loadShortcutsConfig();
  
  // Configure persistent session storage for maximum authentication persistence
  const ses = session.defaultSession;
  
  // Configure persistent storage path
  const persistentDataPath = path.join(app.getPath('userData'), 'Session');
  if (!fs.existsSync(persistentDataPath)) {
    fs.mkdirSync(persistentDataPath, { recursive: true });
  }
  
  // Configure cache settings for better persistence (available in Electron 29+)
  try {
    ses.setCacheSize(100 * 1024 * 1024); // 100MB cache
  } catch (error) {
    console.log('Voice Notes Wrapper: Cache size setting not available in this Electron version');
  }
  
  // Set permissions for microphone
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') {
      // Always allow microphone access for Voice Notes domain
      if (webContents.getURL().includes('voicenotes.com')) {
        return callback(true);
      }
    }
    // Deny other permission requests
    return callback(false);
  });
  
  // Persist permissions across sessions
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'microphone' && requestingOrigin.includes('voicenotes.com')) {
      return true;
    }
    return false;
  });

  createWindow();
  createTray(); // Ensure tray is created separately from window

  // Register F-key shortcuts for recording (F10=Record, F11=Pause, F12=Stop)
  globalShortcut.register('F10', () => {
    console.log('Voice Notes Wrapper: F10 pressed - Start Recording');
    startRecording();
  });

  globalShortcut.register('F11', () => {
    console.log('Voice Notes Wrapper: F11 pressed - Pause Recording');
    pauseRecording();
  });

  globalShortcut.register('F12', () => {
    console.log('Voice Notes Wrapper: F12 pressed - Stop Recording');
    stopRecording();
  });

  // Register configurable shortcuts from config file (for Bluetooth remotes)
  globalShortcut.register(recordingShortcuts.record, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.record} key pressed - Start Recording`);
    startRecording();
  });

  globalShortcut.register(recordingShortcuts.pause, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.pause} key pressed - Pause Recording`);
    pauseRecording();
  });

  globalShortcut.register(recordingShortcuts.stop, () => {
    console.log(`Voice Notes Wrapper: ${recordingShortcuts.stop} key pressed - Stop Recording`);
    stopRecording();
  });

  // Register Ctrl+Alt+F5 for refresh (safer than F5 alone)
  globalShortcut.register('CommandOrControl+Alt+F5', () => {
    console.log('Voice Notes Wrapper: Ctrl+Alt+F5 pressed - Refresh');
    refreshVoiceNotes();
  });

  // Initialize audio monitoring
  audioMonitor = new AudioMonitor();
  audioMonitor.on('deviceUpdate', (deviceInfo) => {
    systemAudioInfo = deviceInfo;
    console.log(`Voice Notes Wrapper: System audio updated - ${deviceInfo.name} (${Math.round(deviceInfo.level * 100)}%)`);
    updateTrayMenu(currentMicrophone);
  });
  
  // Start monitoring system audio
  audioMonitor.startMonitoring(2000); // Update every 2 seconds
  
  console.log('Voice Notes Wrapper: Registered shortcuts:');
  console.log('- F10: Start Recording');
  console.log('- F11: Pause Recording');
  console.log('- F12: Stop Recording');
  console.log(`- ${recordingShortcuts.record}: Start Recording (Bluetooth/Custom)`);
  console.log(`- ${recordingShortcuts.pause}: Pause Recording (Bluetooth/Custom)`);
  console.log(`- ${recordingShortcuts.stop}: Stop Recording (Bluetooth/Custom)`);
  console.log('- Ctrl+Alt+F5: Refresh Voice Notes');
  console.log('Voice Notes Wrapper: System audio monitoring started');

  app.on('activate', () => {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  // Don't quit the app when window is closed - keep running in tray
  // The app will only quit when explicitly requested from tray menu
});

// Clean up before quitting
app.on('before-quit', () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
  
  // Clean up tray
  if (tray) {
    tray.destroy();
    tray = null;
  }
  
  // Stop audio monitoring
  if (audioMonitor) {
    audioMonitor.stopMonitoring();
  }
});

// Handle app activation (clicking on dock icon on macOS)
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
