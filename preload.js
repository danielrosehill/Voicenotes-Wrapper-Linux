// Preload script for Voice Notes Wrapper
// This runs in the context of the renderer process before web content is loaded

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  updateMicrophoneInfo: (micInfo) => ipcRenderer.send('update-microphone-info', micInfo),
  getSystemAudioInfo: () => ipcRenderer.invoke('get-system-audio-info'),
  toggleMicrophoneMute: () => ipcRenderer.invoke('toggle-microphone-mute'),
  getMicrophoneMuteStatus: () => ipcRenderer.invoke('get-microphone-mute-status')
});

window.addEventListener('DOMContentLoaded', () => {
  // This function will run when the page is loaded
  console.log('Voice Notes Wrapper: DOM fully loaded');

  // We can inject custom CSS if needed to make the app more desktop-friendly
  const style = document.createElement('style');
  style.textContent = `
    /* Custom styles for better desktop experience */
    /* These can be adjusted based on the actual Voice Notes UI */
    body {
      /* Ensure proper scrolling behavior */
      overflow: auto !important;
    }
    
    /* Add any other custom styles here */
  `;
  document.head.appendChild(style);

  // Monitor for microphone permission issues and detect active microphone
  navigator.permissions.query({ name: 'microphone' }).then(permissionStatus => {
    console.log('Microphone permission status:', permissionStatus.state);
    
    permissionStatus.onchange = () => {
      console.log('Microphone permission status changed to:', permissionStatus.state);
    };
  });

  // Function to detect and display active microphone
  async function detectActiveMicrophone() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      if (audioInputs.length > 0) {
        // Get the default microphone (first in list or explicitly set)
        const defaultMic = audioInputs.find(device => device.deviceId === 'default') || audioInputs[0];
        console.log('Active microphone:', defaultMic.label || 'Default Microphone');
        
        // Start volume monitoring for this microphone
        startVolumeMonitoring(defaultMic);
        
        return defaultMic;
      }
    } catch (error) {
      console.log('Could not access microphone devices:', error);
    }
    return null;
  }

  // Function to monitor microphone volume levels
  let volumeMonitoringStream = null;
  let volumeAnalyser = null;
  let volumeUpdateInterval = null;

  async function startVolumeMonitoring(micDevice) {
    try {
      // Stop existing monitoring
      stopVolumeMonitoring();
      
      // Get microphone stream to access the track settings
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micDevice.deviceId
        }
      });
      
      volumeMonitoringStream = stream;
      const audioTrack = stream.getAudioTracks()[0];
      
      // Function to get and display system microphone volume
      const updateSystemVolume = async () => {
        try {
          // Get the track settings and capabilities
          const settings = audioTrack.getSettings();
          const capabilities = audioTrack.getCapabilities();
          
          // Try to get volume from various sources
          let volumeLevel = null;
          
          // Check if volume is available in settings
          if (settings.volume !== undefined) {
            volumeLevel = settings.volume;
          }
          // Check if gain is available (some systems use gain instead of volume)
          else if (settings.gain !== undefined) {
            volumeLevel = settings.gain;
          }
          // Check constraints for volume info
          else {
            const constraints = audioTrack.getConstraints();
            if (constraints.volume !== undefined) {
              volumeLevel = typeof constraints.volume === 'number' ? constraints.volume : 0.5;
            }
          }
          
          // If we can't get the exact system volume, try alternative methods
          if (volumeLevel === null) {
            // Try to get volume from MediaStreamTrack constraints
            try {
              const constraints = audioTrack.getConstraints();
              if (constraints.advanced) {
                for (const advanced of constraints.advanced) {
                  if (advanced.volume !== undefined) {
                    volumeLevel = advanced.volume;
                    break;
                  }
                }
              }
            } catch (e) {
              console.log('Could not get volume from constraints:', e);
            }
          }
          
          // If still no system volume, show basic info without volume
          if (volumeLevel === null) {
            console.log('Voice Notes Wrapper: System volume not accessible via Web Audio API');
            updateMicrophoneIndicator(micDevice.label || 'Default Microphone');
            
            if (window.electronAPI) {
              window.electronAPI.updateMicrophoneInfo(`${micDevice.label || 'Default Microphone'} (system vol not accessible)`);
            }
          } else {
            // Update with actual system volume
            updateMicrophoneIndicator(micDevice.label || 'Default Microphone', volumeLevel, false);
            
            if (window.electronAPI) {
              window.electronAPI.updateMicrophoneInfo(`${micDevice.label || 'Default Microphone'} (${Math.round(volumeLevel * 100)}%)`);
            }
          }
          
        } catch (error) {
          console.log('Voice Notes Wrapper: Could not get system volume:', error);
          // Fallback to basic indicator
          updateMicrophoneIndicator(micDevice.label || 'Default Microphone');
        }
      };
      
      // Update volume info every 2 seconds (less frequent since system volume changes less often)
      volumeUpdateInterval = setInterval(updateSystemVolume, 2000);
      
      // Initial update
      updateSystemVolume();
      
      console.log('Voice Notes Wrapper: System volume monitoring started');
      
    } catch (error) {
      console.log('Voice Notes Wrapper: Could not start volume monitoring:', error);
      // Fallback to basic microphone indicator without volume
      updateMicrophoneIndicator(micDevice.label || 'Default Microphone');
    }
  }

  function stopVolumeMonitoring() {
    if (volumeUpdateInterval) {
      clearInterval(volumeUpdateInterval);
      volumeUpdateInterval = null;
    }
    
    if (volumeMonitoringStream) {
      volumeMonitoringStream.getTracks().forEach(track => track.stop());
      volumeMonitoringStream = null;
    }
    
    volumeAnalyser = null;
  }

  // Function to create/update microphone indicator in the UI
  function updateMicrophoneIndicator(micName, volumeLevel = null, isEstimated = false) {
    // Remove existing indicator if present
    const existingIndicator = document.getElementById('voice-notes-mic-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    // Create new microphone indicator
    const indicator = document.createElement('div');
    indicator.id = 'voice-notes-mic-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 10000;
      pointer-events: auto;
      opacity: 0.8;
      transition: opacity 0.3s ease;
      min-width: 250px;
      cursor: pointer;
    `;

    let volumeDisplay = '';
    if (volumeLevel !== null) {
      const volumePercent = Math.round(volumeLevel * 100);
      const volumeBar = '█'.repeat(Math.floor(volumePercent / 10)) + '░'.repeat(10 - Math.floor(volumePercent / 10));
      const prefix = isEstimated ? 'Input Level' : 'System Vol';
      const suffix = isEstimated ? ' (estimated)' : '';
      volumeDisplay = `<br><small>${prefix}: ${volumePercent}% [${volumeBar}]${suffix}</small>`;
    }

    // Function to update the indicator content
    const updateIndicatorContent = (systemInfo, muteStatus) => {
      const systemLevelPercent = Math.round(systemInfo.level * 100);
      const systemLevelBar = '█'.repeat(Math.floor(systemLevelPercent / 10)) + '░'.repeat(10 - Math.floor(systemLevelPercent / 10));
      
      const muteIcon = muteStatus.isMuted ? '🔇' : '🔊';
      const muteText = muteStatus.isMuted ? 'MUTED' : 'LIVE';
      const muteColor = muteStatus.isMuted ? '#ff4444' : '#44ff44';
      
      const systemDisplay = `<br><small>${muteIcon} System: ${systemInfo.name} <span style="color: ${muteColor}; font-weight: bold;">[${muteText}]</span></small><br><small>📊 Level: ${systemLevelPercent}% [${systemLevelBar}]</small><br><small style="color: #aaa;">💡 Click to toggle mute</small>`;
      
      indicator.innerHTML = `🎤 Web: ${micName}${volumeDisplay}${systemDisplay}`;
    };

    // Get both system audio info and mute status
    Promise.all([
      window.electronAPI.getSystemAudioInfo(),
      window.electronAPI.getMicrophoneMuteStatus()
    ]).then(([systemInfo, muteStatus]) => {
      updateIndicatorContent(systemInfo, muteStatus);
    }).catch(() => {
      indicator.innerHTML = `🎤 Web: ${micName}${volumeDisplay}<br><small style="color: #ff4444;">⚠️ System audio unavailable</small>`;
    });

    // Add click handler for mute toggle
    indicator.addEventListener('click', async () => {
      try {
        indicator.style.opacity = '0.5';
        const result = await window.electronAPI.toggleMicrophoneMute();
        
        if (result.success) {
          // Refresh the display with new mute status
          const [systemInfo, muteStatus] = await Promise.all([
            window.electronAPI.getSystemAudioInfo(),
            window.electronAPI.getMicrophoneMuteStatus()
          ]);
          updateIndicatorContent(systemInfo, muteStatus);
          
          // Show brief feedback
          const originalBg = indicator.style.background;
          indicator.style.background = result.isMuted ? 'rgba(255, 68, 68, 0.8)' : 'rgba(68, 255, 68, 0.8)';
          setTimeout(() => {
            indicator.style.background = originalBg;
          }, 500);
        }
      } catch (error) {
        console.log('Voice Notes Wrapper: Error toggling mute:', error);
      } finally {
        indicator.style.opacity = '0.8';
      }
    });

    document.body.appendChild(indicator);

    // Don't auto-fade if showing volume (keep it visible)
    if (volumeLevel === null) {
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.style.opacity = '0.3';
        }
      }, 5000);
    }
  }

  // Function to create refresh button
  function createRefreshButton() {
    // Remove existing button if present
    const existingButton = document.getElementById('voice-notes-refresh-button');
    if (existingButton) {
      existingButton.remove();
    }

    // Create refresh button
    const refreshButton = document.createElement('button');
    refreshButton.id = 'voice-notes-refresh-button';
    refreshButton.innerHTML = '🔄';
    refreshButton.title = 'Refresh Voice Notes (F5)';
    refreshButton.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 123, 255, 0.9);
      color: white;
      border: none;
      padding: 10px;
      border-radius: 50%;
      font-size: 16px;
      cursor: pointer;
      z-index: 10000;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;
    
    // Add hover effects
    refreshButton.addEventListener('mouseenter', () => {
      refreshButton.style.background = 'rgba(0, 123, 255, 1)';
      refreshButton.style.transform = 'scale(1.1)';
    });
    
    refreshButton.addEventListener('mouseleave', () => {
      refreshButton.style.background = 'rgba(0, 123, 255, 0.9)';
      refreshButton.style.transform = 'scale(1)';
    });
    
    // Add click handler
    refreshButton.addEventListener('click', () => {
      console.log('Voice Notes Wrapper: Refresh button clicked');
      refreshButton.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        window.location.reload();
      }, 300);
    });
    
    document.body.appendChild(refreshButton);
  }

  // Create refresh button
  createRefreshButton();
  
  // Add F5 keyboard shortcut for refresh
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
      event.preventDefault();
      console.log('Voice Notes Wrapper: F5 refresh triggered');
      window.location.reload();
    }
  });
  
  // Detect microphone on page load and notify main process
  detectActiveMicrophone().then(micInfo => {
    if (micInfo && window.electronAPI) {
      window.electronAPI.updateMicrophoneInfo(micInfo.label || 'Default Microphone');
    }
  });

  // Monitor for microphone changes
  navigator.mediaDevices.addEventListener('devicechange', () => {
    console.log('Audio devices changed, re-detecting microphone...');
    stopVolumeMonitoring(); // Stop current monitoring
    detectActiveMicrophone().then(micInfo => {
      if (micInfo && window.electronAPI) {
        window.electronAPI.updateMicrophoneInfo(micInfo.label || 'Default Microphone');
      }
    });
  });

  // Enhanced button detection functions
  function findButtonByType(buttonType) {
    const selectors = {
      record: [
        '[data-testid="record-button"]',
        '[data-testid="recording-button"]',
        '[aria-label*="record" i]',
        '[aria-label*="start recording" i]',
        '[title*="record" i]',
        '.record-button',
        '#record-button',
        'button[class*="record" i]',
        'button[id*="record" i]'
      ],
      pause: [
        '[data-testid="pause-button"]',
        '[aria-label*="pause" i]',
        '[title*="pause" i]',
        '.pause-button',
        '#pause-button',
        'button[class*="pause" i]',
        'button[id*="pause" i]'
      ],
      stop: [
        '[data-testid="stop-button"]',
        '[aria-label*="stop" i]',
        '[title*="stop" i]',
        '.stop-button',
        '#stop-button',
        'button[class*="stop" i]',
        'button[id*="stop" i]'
      ]
    };

    const typeSelectors = selectors[buttonType] || [];
    
    // Try specific selectors first
    for (const selector of typeSelectors) {
      const button = document.querySelector(selector);
      if (button && !button.disabled) {
        console.log(`Voice Notes Wrapper: Found ${buttonType} button with selector:`, selector);
        return button;
      }
    }

    // Fallback: search through all buttons for text content
    const buttons = document.querySelectorAll('button');
    const searchTerms = {
      record: ['record', 'mic', 'start'],
      pause: ['pause'],
      stop: ['stop', 'end', 'finish']
    };
    
    const terms = searchTerms[buttonType] || [];
    
    for (const button of buttons) {
      if (button.disabled) continue;
      
      const text = (button.textContent || '').toLowerCase();
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      const title = (button.getAttribute('title') || '').toLowerCase();
      
      for (const term of terms) {
        if (text.includes(term) || ariaLabel.includes(term) || title.includes(term)) {
          console.log(`Voice Notes Wrapper: Found potential ${buttonType} button by text content`);
          return button;
        }
      }
    }

    console.log(`Voice Notes Wrapper: No ${buttonType} button found`);
    return null;
  }

  // Legacy function for backward compatibility
  function findRecordButton() {
    return findButtonByType('record');
  }

  // Make the function available globally for the main process to call
  window.voiceNotesWrapper = {
    // Legacy function for backward compatibility
    findAndClickRecordButton: () => {
      const button = findRecordButton();
      if (button) {
        button.click();
        console.log('Voice Notes Wrapper: Record button clicked successfully');
        return { success: true, action: 'record' };
      }
      return { success: false, error: 'Record button not found' };
    },
    
    // New three-state recording functions
    startRecording: () => {
      const button = findButtonByType('record');
      if (button) {
        button.click();
        console.log('Voice Notes Wrapper: Start recording button clicked');
        return { success: true, action: 'record' };
      }
      return { success: false, error: 'Record button not found or disabled' };
    },
    
    pauseRecording: () => {
      const button = findButtonByType('pause');
      if (button) {
        button.click();
        console.log('Voice Notes Wrapper: Pause recording button clicked');
        return { success: true, action: 'pause' };
      }
      return { success: false, error: 'Pause button not found or disabled' };
    },
    
    stopRecording: () => {
      const button = findButtonByType('stop');
      if (button) {
        button.click();
        console.log('Voice Notes Wrapper: Stop recording button clicked');
        return { success: true, action: 'stop' };
      }
      return { success: false, error: 'Stop button not found or disabled' };
    },
    
    getMicrophoneInfo: detectActiveMicrophone
  };

  // Monitor for dynamic content changes
  const observer = new MutationObserver(() => {
    // Re-check for record button when DOM changes
    if (!window.voiceNotesWrapper.recordButton) {
      window.voiceNotesWrapper.recordButton = findRecordButton();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
});
