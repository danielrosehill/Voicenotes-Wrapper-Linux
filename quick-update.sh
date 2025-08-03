#!/bin/bash

# Quick Update Script for Voicenotes Wrapper
# Simple one-liner for fast updates

set -e

PACKAGE_NAME="voicenotes-wrapper"
NEW_VERSION="2.0.0"
DEB_FILE="dist/voicenotes-wrapper_${NEW_VERSION}_amd64.deb"

echo "🔄 Quick updating Voicenotes Wrapper to v${NEW_VERSION}..."

# Check if DEB file exists
if [[ ! -f "$DEB_FILE" ]]; then
    echo "❌ Error: Package not found. Run 'npm run build' first."
    exit 1
fi

# Stop application if running
pkill -f "voicenotes-wrapper" 2>/dev/null || true
pkill -f "VoiceNotes" 2>/dev/null || true

# Remove old version and install new one
sudo dpkg --remove "$PACKAGE_NAME" 2>/dev/null || true
sudo dpkg -i "$DEB_FILE"
sudo apt-get install -f -y 2>/dev/null || true

echo "✅ Update complete! Launch from Applications menu or run 'voicenotes-wrapper'"
