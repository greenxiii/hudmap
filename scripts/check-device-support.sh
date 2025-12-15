#!/bin/bash

# Script to check iOS device support and help set up device support files
# Usage: ./scripts/check-device-support.sh

echo "🔍 Checking Xcode and iOS Device Support..."
echo ""

# Check Xcode version
XCODE_VERSION=$(xcodebuild -version 2>/dev/null | head -1)
echo "📱 Xcode Version: $XCODE_VERSION"

# Check if device support directory exists
DEVICE_SUPPORT_DIR="$HOME/Library/Developer/Xcode/iOS DeviceSupport"
if [ -d "$DEVICE_SUPPORT_DIR" ]; then
    echo "✅ Device Support directory exists"
    echo "📂 Installed iOS versions:"
    ls -1 "$DEVICE_SUPPORT_DIR" 2>/dev/null | sed 's/^/   - /'
else
    echo "⚠️  Device Support directory not found"
    echo "   Creating it now..."
    mkdir -p "$DEVICE_SUPPORT_DIR"
fi

echo ""
echo "📋 Your iOS version: 18.6.2 (22G100)"
echo ""
echo "💡 Solutions:"
echo ""
echo "1. UPDATE XCODE (Recommended):"
echo "   - Open App Store → Search 'Xcode' → Update"
echo "   - iOS 18.6.2 requires Xcode 16.0+"
echo ""
echo "2. MANUALLY ADD DEVICE SUPPORT (Workaround):"
echo "   - Download from: https://github.com/filsv/iOSDeviceSupport"
echo "   - Look for folder: '18.6.2 (22G100)'"
echo "   - Copy to: $DEVICE_SUPPORT_DIR"
echo ""
echo "3. USE SIMULATOR:"
echo "   - In Xcode, select an iOS Simulator instead"
echo "   - Works for testing, but limited GPS features"
echo ""

# Check if we can detect connected device
if command -v idevice_id &> /dev/null; then
    echo "🔌 Checking for connected devices..."
    idevice_id -l 2>/dev/null && echo "   Device(s) detected" || echo "   No devices detected via USB"
fi

echo ""
echo "For detailed instructions, see: DEVICE_SETUP.md"




