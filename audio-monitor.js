const { exec } = require('child_process');
const { EventEmitter } = require('events');

class AudioMonitor extends EventEmitter {
  constructor() {
    super();
    this.currentInputDevice = null;
    this.currentInputLevel = 0;
    this.monitorInterval = null;
    this.isMonitoring = false;
    this.lastLoggedSource = null;
    this.lastDetailedSource = null;
  }

  // Get current input device information
  async getInputDeviceInfo() {
    return new Promise((resolve, reject) => {
      // First, get the default source
      exec('pactl get-default-source', (error, stdout, stderr) => {
        if (error) {
          console.log('Voice Notes Wrapper: Could not get default source, trying list method...');
          this.getFirstAvailableSource().then(resolve).catch(reject);
          return;
        }

        const defaultSource = stdout.trim();
        // Only log if this is a different source than before
        if (!this.lastLoggedSource || this.lastLoggedSource !== defaultSource) {
          console.log('Voice Notes Wrapper: Default source detected:', defaultSource);
          this.lastLoggedSource = defaultSource;
        }
        
        // Get detailed info for the default source
        this.getDetailedSourceInfoByName(defaultSource).then(resolve).catch(reject);
      });
    });
  }

  // Fallback method to get first available source
  async getFirstAvailableSource() {
    return new Promise((resolve, reject) => {
      exec('pactl list short sources', (error, stdout, stderr) => {
        if (error) {
          console.log('Voice Notes Wrapper: Could not get PulseAudio sources, trying ALSA...');
          this.getAlsaInputInfo().then(resolve).catch(reject);
          return;
        }

        const sources = stdout.split('\n').filter(line => line.trim());
        const inputSources = sources.filter(line => 
          !line.includes('.monitor') && 
          (line.includes('alsa_input') || line.includes('input'))
        );

        if (inputSources.length > 0) {
          // Get detailed info for the first input source
          const sourceId = inputSources[0].split('\t')[0];
          this.getDetailedSourceInfo(sourceId).then(resolve).catch(reject);
        } else {
          resolve({ name: 'No Input Device', level: 0 });
        }
      });
    });
  }

  // Get detailed source information by source name
  async getDetailedSourceInfoByName(sourceName) {
    return new Promise((resolve, reject) => {
      exec(`pactl list sources`, (error, stdout, stderr) => {
        if (error) {
          resolve({ name: 'Unknown Input Device', level: 0 });
          return;
        }

        const sections = stdout.split('Source #');
        let deviceName = 'Unknown Input Device';
        let sourceId = null;
        
        // Only log if this is a different source than before
        if (!this.lastDetailedSource || this.lastDetailedSource !== sourceName) {
          console.log('Voice Notes Wrapper: Looking for source:', sourceName);
        }
        
        // Find the section that matches our source name
        for (const section of sections) {
          if (section.includes(`Name: ${sourceName}`)) {
            if (!this.lastDetailedSource || this.lastDetailedSource !== sourceName) {
              console.log('Voice Notes Wrapper: Found matching section for:', sourceName);
              this.lastDetailedSource = sourceName;
            }
            const lines = section.split('\n');
            sourceId = lines[0].trim();
            
            // Look for device description
            for (const line of lines) {
              if (line.includes('device.description')) {
                const match = line.match(/device\.description = "(.+)"/); 
                if (match) {
                  deviceName = match[1];
                  break;
                }
              }
              if (line.includes('alsa.card_name')) {
                const match = line.match(/alsa\.card_name = "(.+)"/); 
                if (match) {
                  deviceName = match[1];
                  break;
                }
              }
            }
            break;
          }
        }

        // Get current input level
        this.getInputLevelByName(sourceName).then(level => {
          resolve({ name: deviceName, level: level });
        }).catch(() => {
          resolve({ name: deviceName, level: 0 });
        });
      });
    });
  }

  // Get detailed source information by ID (legacy method)
  async getDetailedSourceInfo(sourceId) {
    return new Promise((resolve, reject) => {
      exec(`pactl list sources | grep -A 20 "Source #${sourceId}"`, (error, stdout, stderr) => {
        if (error) {
          resolve({ name: 'Unknown Input Device', level: 0 });
          return;
        }

        const lines = stdout.split('\n');
        let deviceName = 'Unknown Input Device';
        
        // Look for device description
        for (const line of lines) {
          if (line.includes('device.description')) {
            const match = line.match(/device\.description = "(.+)"/); 
            if (match) {
              deviceName = match[1];
              break;
            }
          }
          if (line.includes('alsa.card_name')) {
            const match = line.match(/alsa\.card_name = "(.+)"/); 
            if (match) {
              deviceName = match[1];
              break;
            }
          }
        }

        // Get current input level
        this.getInputLevel(sourceId).then(level => {
          resolve({ name: deviceName, level: level });
        }).catch(() => {
          resolve({ name: deviceName, level: 0 });
        });
      });
    });
  }

  // Get current input level by source name
  async getInputLevelByName(sourceName) {
    return new Promise((resolve, reject) => {
      exec(`pactl list sources | grep -A 10 "Name: ${sourceName}" | grep "Volume:"`, (error, stdout, stderr) => {
        if (error) {
          resolve(0);
          return;
        }

        // Parse volume percentage
        const volumeMatch = stdout.match(/(\d+)%/);
        if (volumeMatch) {
          resolve(parseInt(volumeMatch[1]) / 100);
        } else {
          resolve(0);
        }
      });
    });
  }

  // Get current input level for a source (legacy method)
  async getInputLevel(sourceId) {
    return new Promise((resolve, reject) => {
      exec(`pactl list sources | grep -A 5 "Source #${sourceId}" | grep "Volume:"`, (error, stdout, stderr) => {
        if (error) {
          resolve(0);
          return;
        }

        // Parse volume percentage
        const volumeMatch = stdout.match(/(\d+)%/);
        if (volumeMatch) {
          resolve(parseInt(volumeMatch[1]) / 100);
        } else {
          resolve(0);
        }
      });
    });
  }

  // Fallback to ALSA if PulseAudio is not available
  async getAlsaInputInfo() {
    return new Promise((resolve, reject) => {
      exec('arecord -l', (error, stdout, stderr) => {
        if (error) {
          resolve({ name: 'System Audio Input', level: 0 });
          return;
        }

        const lines = stdout.split('\n');
        let deviceName = 'System Audio Input';
        
        for (const line of lines) {
          if (line.includes('card') && line.includes('device')) {
            const match = line.match(/card \d+: (.+?) \[/);
            if (match) {
              deviceName = match[1].trim();
              break;
            }
          }
        }

        resolve({ name: deviceName, level: 0 });
      });
    });
  }

  // Start monitoring input levels
  startMonitoring(intervalMs = 1000) {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitorInterval = setInterval(async () => {
      try {
        const deviceInfo = await this.getInputDeviceInfo();
        
        // Only emit if device info has changed
        if (!this.currentInputDevice || 
            this.currentInputDevice.name !== deviceInfo.name ||
            Math.abs(this.currentInputDevice.level - deviceInfo.level) > 0.05) {
          
          this.currentInputDevice = deviceInfo;
          this.emit('deviceUpdate', deviceInfo);
        }
      } catch (error) {
        console.log('Voice Notes Wrapper: Error monitoring audio:', error.message);
      }
    }, intervalMs);

    // Get initial device info
    this.getInputDeviceInfo().then(deviceInfo => {
      this.currentInputDevice = deviceInfo;
      this.emit('deviceUpdate', deviceInfo);
    }).catch(error => {
      console.log('Voice Notes Wrapper: Error getting initial device info:', error.message);
    });
  }

  // Stop monitoring
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
  }

  // Get current device info without starting monitoring
  async getCurrentDevice() {
    return this.getInputDeviceInfo();
  }

  // Toggle microphone mute status
  async toggleMute() {
    return new Promise((resolve, reject) => {
      // First get the current default source
      exec('pactl get-default-source', (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Could not get default source'));
          return;
        }

        const defaultSource = stdout.trim();
        
        // Toggle mute for the default source
        exec(`pactl set-source-mute ${defaultSource} toggle`, (error, stdout, stderr) => {
          if (error) {
            reject(new Error('Could not toggle mute'));
            return;
          }

          // Get the new mute status
          this.getMuteStatus().then(status => {
            resolve({ success: true, isMuted: status.isMuted, sourceName: defaultSource });
          }).catch(reject);
        });
      });
    });
  }

  // Get current microphone mute status
  async getMuteStatus() {
    return new Promise((resolve, reject) => {
      // First get the current default source
      exec('pactl get-default-source', (error, stdout, stderr) => {
        if (error) {
          reject(new Error('Could not get default source'));
          return;
        }

        const defaultSource = stdout.trim();
        
        // Get mute status for the default source
        exec(`pactl list sources | grep -A 10 "Name: ${defaultSource}" | grep "Mute:"`, (error, stdout, stderr) => {
          if (error) {
            resolve({ isMuted: false, sourceName: defaultSource });
            return;
          }

          const isMuted = stdout.includes('Mute: yes');
          resolve({ isMuted: isMuted, sourceName: defaultSource });
        });
      });
    });
  }
}

module.exports = AudioMonitor;
