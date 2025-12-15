# Quick Start Guide

## Prerequisites Check

Before starting, ensure you have:
- ✅ Node.js 18+ installed
- ✅ Xcode 16+ installed (required for iOS 18.x devices; Xcode 14+ works for iOS 16.x and below)
- ✅ CocoaPods installed (`sudo gem install cocoapods`)
- ✅ React Native CLI (optional, we'll use npx)

## Initial Setup (First Time)

### 1. Install Dependencies

```bash
npm install
```

### 2. Install iOS Pods

```bash
cd ios
pod install
cd ..
```

**Note:** If the `ios` directory doesn't exist yet, you'll need to initialize the React Native project first (see below).

### 3. Initialize React Native Project (If Needed)

If you're starting from scratch and the `ios` folder doesn't exist:

```bash
# This will create the iOS and Android native projects
npx react-native init HudMap --skip-install --template react-native-template-typescript

# Then copy our source files over (they should already be in place)
# Install dependencies
npm install

# Install pods
cd ios
pod install
cd ..
```

**However**, since we've already created the project structure, you may just need to:

1. Ensure the iOS project exists. If not, you can generate it:
   ```bash
   npx @react-native-community/cli init HudMap --skip-install
   ```
   Then merge our custom files.

2. Or manually create the Xcode project in Xcode and link it properly.

### 4. Run the App

```bash
npm run ios
```

Or specify a device:
```bash
npm run ios -- --device "iPhone 15 Pro"
```

## What to Expect

1. **First Launch:**
   - App requests location permission
   - Grant permission to see the HUD
   - HUD displays with nearby roads (fetched from OpenStreetMap)
   - Route shows as a green line (currently mocked to San Francisco)

2. **HUD Display:**
   - Circular minimap in center
   - Thin gray lines = nearby roads
   - Thick green line = route
   - White triangle = your position (center)
   - Text below shows next turn and distance

3. **Testing:**
   - Move around (in simulator, use Features → Location → Custom Location)
   - Roads update when you move >150m or after 15 seconds
   - Route rotates based on your heading (currently mocked to 0°)

## Troubleshooting

### "Command not found: pod"

Install CocoaPods:
```bash
sudo gem install cocoapods
```

### "No such file or directory: ios/Podfile"

The iOS project needs to be initialized. See step 3 above.

### "Module not found" errors

1. Clear Metro cache:
   ```bash
   npm start -- --reset-cache
   ```

2. Reinstall dependencies:
   ```bash
   rm -rf node_modules
   npm install
   ```

3. Reinstall pods:
   ```bash
   cd ios
   rm -rf Pods Podfile.lock
   pod install
   cd ..
   ```

### Location not working

1. Check Info.plist has location permissions
2. Grant permission in iOS Settings → Privacy → Location Services
3. In Simulator: Features → Location → Custom Location (set coordinates)

### "Xcode doesn't support [Device]'s iOS [Version]"

Your Xcode version is too old for the iOS version on your device. 

**Quick Solutions:**
1. **Update Xcode** (Best): App Store → Search "Xcode" → Update (requires Xcode 16.0+ for iOS 18.x)
2. **Manual Device Support** (Workaround): See `DEVICE_SETUP.md` for instructions to manually add device support files
3. **Use Simulator**: Select an iOS Simulator in Xcode instead of physical device

**Version Requirements:**
- **iOS 18.x** requires **Xcode 16.0+**
- **iOS 17.x** requires **Xcode 15.0+**
- **iOS 16.x** requires **Xcode 14.0+**

**Check your setup:**
```bash
./scripts/check-device-support.sh
```

For detailed troubleshooting, see `DEVICE_SETUP.md`.

### Skia not rendering

1. Ensure pods are installed:
   ```bash
   cd ios && pod install && cd ..
   ```

2. Open the workspace (not project):
   ```bash
   open ios/HudMap.xcworkspace
   ```

3. Clean build in Xcode: Cmd+Shift+K

## Next Steps

1. **Test Share Extension:** See `SHARE_EXTENSION_GUIDE.md`
2. **Integrate Real Routing:** Replace stub in `src/services/routing.ts`
3. **Add Heading Support:** Implement CoreLocation heading API
4. **Customize HUD:** Adjust colors, sizes in `src/screens/HudScreen.tsx`

## Project Structure Overview

```
HudMap/
├── src/
│   ├── models/types.ts          # Type definitions
│   ├── screens/HudScreen.tsx    # Main HUD component
│   ├── services/                # API services
│   │   ├── location.ts          # GPS location
│   │   ├── overpass.ts          # OpenStreetMap roads
│   │   └── routing.ts           # Route calculation
│   ├── utils/                   # Utilities
│   │   ├── geo.ts               # Geographic math
│   │   └── urlHandler.ts        # URL scheme handler
│   └── types/                   # Type declarations
├── ios/                         # iOS native project
├── App.tsx                      # Root component
└── package.json                 # Dependencies
```

## Development Tips

- **Hot Reload:** Enabled by default, save files to see changes
- **Debugging:** Use React Native Debugger or Chrome DevTools
- **Location Testing:** Use Xcode's location simulation features
- **API Testing:** Check console logs for Overpass API responses

## Support

For issues:
1. Check `README.md` for detailed documentation
2. Check `SETUP.md` for setup instructions
3. Check `SHARE_EXTENSION_GUIDE.md` for share extension setup

