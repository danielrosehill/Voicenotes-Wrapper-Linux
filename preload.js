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

  // Function to create/update microphone banner in the UI
  function updateMicrophoneIndicator(micName, volumeLevel = null, isEstimated = false) {
    // Remove existing banner if present
    const existingBanner = document.getElementById('voice-notes-mic-banner');
    if (existingBanner) {
      existingBanner.remove();
    }

    // Create new microphone banner
    const banner = document.createElement('div');
    banner.id = 'voice-notes-mic-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
      color: white;
      padding: 12px 20px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 10000;
      pointer-events: auto;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      border-bottom: 2px solid #3498db;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      transition: all 0.3s ease;
    `;

    // Create left section with microphone info
    const leftSection = document.createElement('div');
    leftSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 20px;
      flex: 1;
    `;

    // Create microphone info container
    const micInfo = document.createElement('div');
    micInfo.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    // Create system audio info container
    const systemInfo = document.createElement('div');
    systemInfo.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
    `;

    // Create mute button
    const muteButton = document.createElement('button');
    muteButton.style.cssText = `
      background: #e74c3c;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 100px;
    `;
    muteButton.textContent = 'Loading...';

    // Add hover effect to mute button
    muteButton.addEventListener('mouseenter', () => {
      muteButton.style.transform = 'scale(1.05)';
      muteButton.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    });
    muteButton.addEventListener('mouseleave', () => {
      muteButton.style.transform = 'scale(1)';
      muteButton.style.boxShadow = 'none';
    });

    // Function to update the banner content
    const updateBannerContent = (systemAudioInfo, muteStatus) => {
      const systemLevelPercent = Math.round(systemAudioInfo.level * 100);
      const systemLevelBar = '█'.repeat(Math.floor(systemLevelPercent / 10)) + '░'.repeat(10 - Math.floor(systemLevelPercent / 10));
      
      const muteIcon = muteStatus.isMuted ? '🔇' : '🎤';
      const muteText = muteStatus.isMuted ? 'UNMUTE' : 'MUTE';
      const muteColor = muteStatus.isMuted ? '#e74c3c' : '#27ae60';
      const statusText = muteStatus.isMuted ? 'MUTED' : 'LIVE';
      const statusColor = muteStatus.isMuted ? '#e74c3c' : '#27ae60';
      
      // Update microphone info
      let webVolumeDisplay = '';
      if (volumeLevel !== null) {
        const volumePercent = Math.round(volumeLevel * 100);
        const volumeBar = '█'.repeat(Math.floor(volumePercent / 10)) + '░'.repeat(10 - Math.floor(volumePercent / 10));
        const prefix = isEstimated ? 'Input Level' : 'Web Level';
        const suffix = isEstimated ? ' (estimated)' : '';
        webVolumeDisplay = `<div style="font-size: 12px; color: #bdc3c7;">${prefix}: ${volumePercent}% [${volumeBar}]${suffix}</div>`;
      }
      
      micInfo.innerHTML = `
        <div style="font-weight: bold; color: #3498db;">🎤 Web Microphone</div>
        <div style="font-size: 13px; color: #ecf0f1;">${micName}</div>
        ${webVolumeDisplay}
      `;
      
      // Update system info
      systemInfo.innerHTML = `
        <div style="font-weight: bold; color: #f39c12;">${muteIcon} System Audio</div>
        <div style="font-size: 13px; color: #ecf0f1;">${systemAudioInfo.name}</div>
        <div style="font-size: 12px; color: #bdc3c7;">Level: ${systemLevelPercent}% [${systemLevelBar}]</div>
        <div style="font-size: 12px; font-weight: bold; color: ${statusColor};">[${statusText}]</div>
      `;
      
      // Update mute button
      muteButton.textContent = muteText;
      muteButton.style.background = muteColor;
    };

    // Get both system audio info and mute status
    Promise.all([
      window.electronAPI.getSystemAudioInfo(),
      window.electronAPI.getMicrophoneMuteStatus()
    ]).then(([systemAudioInfo, muteStatus]) => {
      updateBannerContent(systemAudioInfo, muteStatus);
    }).catch(() => {
      micInfo.innerHTML = `
        <div style="font-weight: bold; color: #3498db;">🎤 Web Microphone</div>
        <div style="font-size: 13px; color: #ecf0f1;">${micName}</div>
      `;
      systemInfo.innerHTML = `
        <div style="font-weight: bold; color: #e74c3c;">⚠️ System Audio Unavailable</div>
        <div style="font-size: 12px; color: #bdc3c7;">Cannot access system microphone controls</div>
      `;
      muteButton.textContent = 'N/A';
      muteButton.disabled = true;
      muteButton.style.background = '#7f8c8d';
      muteButton.style.cursor = 'not-allowed';
    });

    // Add click handler for mute toggle
    muteButton.addEventListener('click', async () => {
      if (muteButton.disabled) return;
      
      try {
        muteButton.disabled = true;
        muteButton.textContent = 'Working...';
        muteButton.style.opacity = '0.7';
        
        const result = await window.electronAPI.toggleMicrophoneMute();
        
        if (result.success) {
          // Refresh the display with new mute status
          const [systemAudioInfo, muteStatus] = await Promise.all([
            window.electronAPI.getSystemAudioInfo(),
            window.electronAPI.getMicrophoneMuteStatus()
          ]);
          updateBannerContent(systemAudioInfo, muteStatus);
          
          // Brief visual feedback
          banner.style.borderBottomColor = result.isMuted ? '#e74c3c' : '#27ae60';
          setTimeout(() => {
            banner.style.borderBottomColor = '#3498db';
          }, 1000);
        }
      } catch (error) {
        console.log('Voice Notes Wrapper: Error toggling mute:', error);
      } finally {
        muteButton.disabled = false;
        muteButton.style.opacity = '1';
      }
    });

    // Assemble the banner
    leftSection.appendChild(micInfo);
    leftSection.appendChild(systemInfo);
    banner.appendChild(leftSection);
    banner.appendChild(muteButton);
    
    // Add banner to page and adjust body padding
    document.body.appendChild(banner);
    
    // Add padding to body to prevent content from being hidden behind banner
    if (!document.body.style.paddingTop || document.body.style.paddingTop === '0px') {
      document.body.style.paddingTop = '80px';
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
  console.log('Voice Notes Wrapper: Starting microphone detection...');
  detectActiveMicrophone().then(micInfo => {
    if (micInfo && window.electronAPI) {
      console.log('Voice Notes Wrapper: Microphone detected, updating info:', micInfo.label);
      window.electronAPI.updateMicrophoneInfo(micInfo.label || 'Default Microphone');
    } else {
      console.log('Voice Notes Wrapper: No microphone detected, creating banner with fallback');
      // Create banner even without microphone access
      updateMicrophoneIndicator('No Microphone Access');
    }
  }).catch(error => {
    console.log('Voice Notes Wrapper: Error detecting microphone:', error);
    // Create banner even on error
    updateMicrophoneIndicator('Microphone Error');
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
