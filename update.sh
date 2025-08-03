#!/bin/bash

# Voicenotes Wrapper Update Script
# This script will uninstall the current version and install the new one

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
PACKAGE_NAME="voicenotes-wrapper"
NEW_VERSION="2.0.0"
DEB_FILE="dist/voicenotes-wrapper_${NEW_VERSION}_amd64.deb"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root!"
        print_status "Please run as a regular user. The script will prompt for sudo when needed."
        exit 1
    fi
}

# Function to check if the DEB file exists
check_deb_file() {
    if [[ ! -f "$DEB_FILE" ]]; then
        print_error "Debian package not found: $DEB_FILE"
        print_status "Please run 'npm run build' first to create the package."
        exit 1
    fi
    
    print_success "Found package: $DEB_FILE"
    
    # Show file size
    local file_size=$(du -h "$DEB_FILE" | cut -f1)
    print_status "Package size: $file_size"
}

# Function to check if the package is currently installed
check_current_installation() {
    if dpkg -l | grep -q "^ii.*$PACKAGE_NAME"; then
        local current_version=$(dpkg -l | grep "$PACKAGE_NAME" | awk '{print $3}')
        print_status "Current version installed: $current_version"
        return 0
    else
        print_warning "No previous version of $PACKAGE_NAME found"
        return 1
    fi
}

# Function to stop the application if running
stop_application() {
    print_status "Checking if Voicenotes Wrapper is running..."
    
    # Check for running processes
    if pgrep -f "voicenotes-wrapper" > /dev/null || pgrep -f "VoiceNotes" > /dev/null; then
        print_warning "Voicenotes Wrapper is currently running"
        print_status "Attempting to stop the application..."
        
        # Try to kill gracefully first
        pkill -f "voicenotes-wrapper" 2>/dev/null || true
        pkill -f "VoiceNotes" 2>/dev/null || true
        
        # Wait a moment
        sleep 2
        
        # Force kill if still running
        if pgrep -f "voicenotes-wrapper" > /dev/null || pgrep -f "VoiceNotes" > /dev/null; then
            print_warning "Forcing application to stop..."
            pkill -9 -f "voicenotes-wrapper" 2>/dev/null || true
            pkill -9 -f "VoiceNotes" 2>/dev/null || true
        fi
        
        print_success "Application stopped"
    else
        print_status "Application is not currently running"
    fi
}

# Function to backup user data
backup_user_data() {
    local config_dir="$HOME/.config/voicenotes-wrapper"
    local backup_dir="$HOME/.config/voicenotes-wrapper-backup-$(date +%Y%m%d-%H%M%S)"
    
    if [[ -d "$config_dir" ]]; then
        print_status "Backing up user configuration..."
        cp -r "$config_dir" "$backup_dir"
        print_success "Configuration backed up to: $backup_dir"
    else
        print_status "No user configuration found to backup"
    fi
}

# Function to uninstall current version
uninstall_current() {
    if check_current_installation; then
        print_status "Uninstalling current version..."
        
        # Remove the package
        sudo dpkg --remove "$PACKAGE_NAME" 2>/dev/null || true
        
        # Clean up any remaining dependencies
        sudo apt-get autoremove -y 2>/dev/null || true
        
        print_success "Previous version uninstalled"
    fi
}

# Function to install new version
install_new_version() {
    print_status "Installing Voicenotes Wrapper v${NEW_VERSION}..."
    
    # Install the new package
    sudo dpkg -i "$DEB_FILE"
    
    # Fix any dependency issues
    sudo apt-get install -f -y 2>/dev/null || true
    
    print_success "Voicenotes Wrapper v${NEW_VERSION} installed successfully!"
}

# Function to verify installation
verify_installation() {
    print_status "Verifying installation..."
    
    if dpkg -l | grep -q "^ii.*$PACKAGE_NAME.*$NEW_VERSION"; then
        print_success "Installation verified successfully"
        
        # Check if the binary exists
        if command -v voicenotes-wrapper >/dev/null 2>&1; then
            print_success "Application binary is available"
        fi
        
        # Check desktop entry
        if [[ -f "/usr/share/applications/voicenotes-wrapper.desktop" ]]; then
            print_success "Desktop entry created"
        fi
        
        return 0
    else
        print_error "Installation verification failed"
        return 1
    fi
}

# Function to show post-installation instructions
show_post_install_info() {
    echo
    print_success "=== UPDATE COMPLETE ==="
    echo
    print_status "Voicenotes Wrapper v${NEW_VERSION} has been successfully installed!"
    echo
    print_status "New features in v${NEW_VERSION}:"
    echo "  • Microphone banner UI at the top of the interface"
    echo "  • Real-time microphone name and level display"
    echo "  • System audio controls with mute/unmute button"
    echo "  • Modern gradient design with visual feedback"
    echo "  • Automatic layout adjustment"
    echo
    print_status "You can now:"
    echo "  • Launch from Applications menu: 'Voicenotes'"
    echo "  • Run from terminal: 'voicenotes-wrapper'"
    echo "  • Use keyboard shortcuts: F10 (Record), F11 (Pause), F12 (Stop)"
    echo
    print_status "Your previous configuration has been preserved."
    echo
}

# Main execution
main() {
    echo
    print_status "=== Voicenotes Wrapper Update Script ==="
    print_status "Updating to version: $NEW_VERSION"
    echo
    
    # Pre-flight checks
    check_root
    check_deb_file
    
    # Show current status
    check_current_installation
    
    # Confirm with user
    echo
    read -p "Do you want to proceed with the update? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Update cancelled by user"
        exit 0
    fi
    
    echo
    print_status "Starting update process..."
    
    # Execute update steps
    stop_application
    backup_user_data
    uninstall_current
    install_new_version
    
    # Verify and complete
    if verify_installation; then
        show_post_install_info
    else
        print_error "Update completed but verification failed"
        print_status "Please check the installation manually"
        exit 1
    fi
}

# Run main function
main "$@"
