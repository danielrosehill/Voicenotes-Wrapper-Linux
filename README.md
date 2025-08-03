# Voice Notes Desktop Wrapper

A desktop application wrapper for the Voice Notes web application (voicenotes.com) built with Electron for Ubuntu Linux.

## Features

- Access Voice Notes in a dedicated desktop application
- Persistent authentication between sessions
- Automatic microphone permissions for voice input
- Native desktop notifications
- Confined to the voicenotes.com domain for security

## Installation

### Prerequisites

- Node.js (v16 or later)
- npm (v7 or later)

### Development Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/danielrosehill/Voicenotes-Wrapper.git
   cd Voicenotes-Wrapper
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application:
   ```bash
   npm start
   ```

### Building for Distribution

To create distributable packages for Ubuntu Linux:

```bash
npm run build
```

This will generate:
- A `.deb` package for Debian-based distributions
- An AppImage that can run on most Linux distributions

The output files will be in the `dist` directory.

## Usage

After installation, launch "Voice Notes" from your application menu. The application will open directly to the Voice Notes web interface. Log in with your Voice Notes account credentials, which will be remembered for future sessions.

Microphone permissions will be automatically granted for the Voice Notes domain.

## Troubleshooting

### Microphone Access

If you experience issues with microphone access:

1. Check that your system's microphone is working properly
2. Ensure you've granted microphone permissions to the application
3. Restart the application

### Authentication Issues

If you're experiencing login problems:

1. Clear the application data by removing the directory: `~/.config/voicenotes-wrapper`
2. Restart the application and log in again
 
