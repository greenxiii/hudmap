# HudMap

A React Native iOS app that displays a circular "NFS Underground-style" navigation HUD with nearby roads, route, and player position.

## Features

- **Circular Minimap HUD**: Renders a round navigation display with roads, route, and player marker
- **OpenStreetMap Integration**: Fetches nearby roads from Overpass API with caching and throttling
- **Location Tracking**: Uses CoreLocation to get position and heading
- **Route Display**: Shows route as a highlighted line (currently mocked, ready for real routing API)
- **Share Extension Support**: Accepts shared destinations from Google Maps or Waze (URL scheme configured)

## Tech Stack

- React Native CLI (not Expo)
- TypeScript
- react-native-skia for rendering
- CoreLocation for GPS
- OpenStreetMap Overpass API

## Setup Instructions

### Prerequisites

- Node.js 18+
- Xcode 14+ (for iOS development)
- CocoaPods
- React Native CLI

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install iOS pods:**
   ```bash
   cd ios
   pod install
   cd ..
   ```

3. **Run on iOS Simulator:**
   ```bash
   npm run ios
   ```

   Or specify a device:
   ```bash
   npm run ios -- --device "iPhone 15 Pro"
   ```

### Project Structure

```
HudMap/
├── src/
│   ├── models/
│   │   └── types.ts          # TypeScript type definitions
│   ├── screens/
│   │   └── HudScreen.tsx     # Main HUD display component
│   ├── services/
│   │   ├── location.ts       # CoreLocation wrapper
│   │   ├── overpass.ts       # OpenStreetMap Overpass API
│   │   └── routing.ts        # Routing service (stub)
│   └── utils/
│       ├── geo.ts            # Geographic calculations
│       └── urlHandler.ts     # URL scheme handler
├── ios/                       # iOS native project
├── App.tsx                    # Root component
└── package.json
```

## Usage

### Running the App

1. Start Metro bundler:
   ```bash
   npm start
   ```

2. Run on iOS:
   ```bash
   npm run ios
   ```

### Testing with Mocked Destination

The app currently uses a mocked destination (San Francisco downtown) for testing. This will be replaced once the Share Extension is fully configured.

### Testing URL Scheme

You can test the URL scheme handler by opening a URL like:
```
hudmap://import?url=https://www.google.com/maps?q=37.7749,-122.4194
```

## Share Extension Setup (Manual Steps)

The app is configured with a URL scheme (`hudmap://`), but a full Share Extension requires additional Xcode configuration:

### Option 1: URL Scheme (Currently Configured)

The app can receive URLs via the `hudmap://` scheme. To test:
1. Open Safari on iOS
2. Navigate to: `hudmap://import?url=https://www.google.com/maps?q=37.7749,-122.4194`

### Option 2: Share Extension (Requires Xcode Setup)

To enable sharing from Google Maps/Waze directly:

1. **Open Xcode:**
   ```bash
   open ios/HudMap.xcworkspace
   ```

2. **Add Share Extension Target:**
   - File → New → Target
   - Choose "Share Extension"
   - Name it "HudMapShareExtension"
   - Language: Objective-C or Swift

3. **Configure Share Extension:**
   - In the Share Extension's `Info.plist`, add:
     ```xml
     <key>NSExtension</key>
     <dict>
         <key>NSExtensionAttributes</key>
         <dict>
             <key>NSExtensionActivationRule</key>
             <dict>
                 <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
                 <integer>1</integer>
             </dict>
         </dict>
         <key>NSExtensionPrincipalClass</key>
         <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
     </dict>
     ```

4. **Create ShareViewController:**
   - Create a new file `ShareViewController.m` (or `.swift`)
   - Implement the share extension to extract the URL and pass it to the main app
   - Use `NSUserDefaults` with an App Group or URL scheme to communicate with the main app

5. **Update App.tsx:**
   - Modify `App.tsx` to listen for shared URLs via the URL handler
   - See `src/utils/urlHandler.ts` for the handler implementation

**Note:** Full Share Extension implementation is left as a TODO. The current setup supports URL scheme testing.

## Configuration

### Location Permissions

Location permissions are configured in `ios/HudMap/Info.plist`:
- `NSLocationWhenInUseUsageDescription`: Required for location access

### API Endpoints

- **Overpass API**: Uses `https://overpass-api.de/api/interpreter` (public instance)
- **Caching**: Roads are cached for 15 seconds or until user moves >150m

## TODOs

- [ ] Implement full iOS Share Extension for seamless Google Maps/Waze integration
- [ ] Integrate real routing API (OSRM, GraphHopper, or Mapbox Directions)
- [ ] Implement proper heading updates using CoreLocation heading API
- [ ] Add turn-by-turn navigation logic
- [ ] Implement BLE streaming to ESP32 for external display
- [ ] Add map matching for route following
- [ ] Improve error handling and retry logic
- [ ] Add unit tests

## Troubleshooting

### Location Not Working

- Ensure location permissions are granted in iOS Settings
- Check that `NSLocationWhenInUseUsageDescription` is set in Info.plist
- Verify location services are enabled on the device/simulator

### Skia Not Rendering

- Ensure pods are installed: `cd ios && pod install`
- Check that `@shopify/react-native-skia` is properly linked
- Try cleaning build: `cd ios && xcodebuild clean`

### Overpass API Errors

- The public Overpass API may have rate limits
- Check network connectivity
- Verify the query format in `src/services/overpass.ts`

## License

MIT

