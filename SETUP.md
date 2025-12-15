# Setup Guide

## Initial Project Setup

This guide assumes you're starting from scratch. If you already have React Native CLI installed, skip to step 2.

### 1. Install React Native CLI

```bash
npm install -g react-native-cli
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install iOS Dependencies

```bash
cd ios
pod install
cd ..
```

### 4. Initialize React Native iOS Project

**Important:** The iOS native project files (`.xcodeproj`, `AppDelegate`, etc.) are not included in this repository. You need to generate them.

#### Option A: Initialize Fresh Project (Recommended)

If starting from scratch:

```bash
# Create a new RN project in a temporary location
npx react-native init HudMapTemp --template react-native-template-typescript

# Copy the iOS project files
cp -r HudMapTemp/ios/* ios/
cp HudMapTemp/android android 2>/dev/null || true

# Clean up
rm -rf HudMapTemp
```

#### Option B: Use React Native CLI

```bash
# If you have react-native CLI installed globally
react-native init HudMap --template react-native-template-typescript --skip-install
```

Then merge our custom source files.

#### Option C: Manual Xcode Setup

1. Open Xcode
2. Create a new project → iOS → App
3. Configure it to match React Native requirements
4. Link React Native dependencies

**After iOS project is set up:**

1. Open Xcode:
   ```bash
   open ios/HudMap.xcworkspace
   ```
   (If workspace doesn't exist, open `ios/HudMap.xcodeproj` first, then run `pod install`)

2. Verify the project builds:
   - Select a simulator or device
   - Press Cmd+B to build

### 5. Required Permissions

The app requires location permissions. These are configured in `ios/HudMap/Info.plist`:

- `NSLocationWhenInUseUsageDescription` - Already configured
- `NSLocationAlwaysAndWhenInUseUsageDescription` - Already configured

### 6. Run the App

```bash
npm run ios
```

Or specify a device:
```bash
npm run ios -- --device "iPhone 15 Pro"
```

## Additional Dependencies

The project uses:
- `@shopify/react-native-skia` - For rendering the HUD
- `react-native-url-polyfill` - For URL parsing in React Native

These are already listed in `package.json`.

## Babel Configuration

The project uses `babel-plugin-module-resolver` for path aliases. If you encounter import errors, ensure the babel config is correct.

## TypeScript Configuration

TypeScript is configured with strict mode enabled. Path aliases are set up for `@/*` imports.

## Testing the HUD

1. **With Mocked Location:**
   - The app will request location permission on first launch
   - Grant permission to see the HUD

2. **With Mocked Destination:**
   - Currently uses San Francisco coordinates
   - Will be replaced when Share Extension is configured

3. **Testing URL Scheme:**
   - Open Safari on iOS
   - Navigate to: `hudmap://import?url=https://www.google.com/maps?q=37.7749,-122.4194`
   - The app should open and extract the destination

## Common Issues

### Pod Install Fails

```bash
cd ios
rm -rf Pods Podfile.lock
pod install --repo-update
cd ..
```

### Metro Bundler Issues

```bash
npm start -- --reset-cache
```

### Xcode Build Errors

1. Clean build folder: Cmd+Shift+K in Xcode
2. Delete DerivedData:
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData
   ```
3. Rebuild

### Skia Not Found

Ensure pods are installed and the workspace (not project) is opened:
```bash
cd ios
pod install
open HudMap.xcworkspace  # Not .xcodeproj
```

