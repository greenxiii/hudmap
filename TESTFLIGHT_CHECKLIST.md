# TestFlight Preparation Checklist

Use this checklist to ensure your app is ready for TestFlight distribution.

## Pre-Flight Checks

### 1. App Store Connect Setup
- [ ] Apple Developer account is active
- [ ] App record created in App Store Connect
- [ ] Bundle ID matches: `com.hudmap.app`
- [ ] App information filled in (name, description, keywords)
- [ ] Privacy policy URL provided (required for TestFlight)
- [ ] App privacy questions answered
- [ ] Support URL provided

### 2. Xcode Configuration
- [ ] Version number set: `1.0` (MARKETING_VERSION)
- [ ] Build number set: `1` (CURRENT_PROJECT_VERSION) - increment for each upload
- [ ] Bundle Identifier: `com.hudmap.app`
- [ ] Signing & Capabilities configured
  - [ ] Team selected
  - [ ] "Automatically manage signing" enabled
  - [ ] Provisioning profile valid
- [ ] Build configuration set to **Release** for archive

### 3. App Assets
- [ ] App icon configured (1024x1024 required for App Store)
- [ ] Launch screen configured
- [ ] All required app icons present in Images.xcassets

### 4. Permissions & Info.plist
- [ ] `NSLocationWhenInUseUsageDescription` present
- [ ] Location permission description is user-friendly
- [ ] App Transport Security configured correctly

### 5. Code Quality
- [ ] App builds without errors in Release configuration
- [ ] No console errors in production build
- [ ] Tested on physical device (not just simulator)
- [ ] Location services work correctly
- [ ] Map rendering works correctly
- [ ] Route building works correctly
- [ ] North arrow displays and rotates correctly

### 6. Build & Archive
- [ ] Cleaned build folder
- [ ] Pods installed and up to date
- [ ] Selected "Any iOS Device" or "Generic iOS Device" (not simulator)
- [ ] Archive created successfully
- [ ] Archive appears in Organizer

### 7. Upload
- [ ] Selected "Distribute App" → "App Store Connect" → "Upload"
- [ ] Upload completed successfully
- [ ] No upload errors

### 8. App Store Connect Processing
- [ ] Build appears in TestFlight → iOS Builds
- [ ] Build processing completed (check email for status)
- [ ] No processing errors

### 9. TestFlight Setup
- [ ] Internal testing group created (optional)
- [ ] External testing group created (if needed)
- [ ] Testers added
- [ ] Build assigned to testing group
- [ ] Testing started

### 10. First External Build (if applicable)
- [ ] "What to Test" information filled in
- [ ] Submitted for App Review
- [ ] Review approved (24-48 hour wait)

## Quick Commands

```bash
# 1. Clean and prepare
cd /Users/green/Sites/HudMap/ios
pod install
xcodebuild clean -workspace HudMap.xcworkspace -scheme HudMap

# 2. Open in Xcode for archiving
open HudMap.xcworkspace

# 3. In Xcode:
# - Select "Any iOS Device"
# - Product → Archive
# - Distribute App → App Store Connect → Upload
```

## Version Numbering

- **Version (MARKETING_VERSION)**: User-facing version (1.0, 1.1, 2.0)
- **Build (CURRENT_PROJECT_VERSION)**: Internal build number (1, 2, 3...)

**Rule**: Increment build number for each TestFlight upload. Each build number can only be used once per version.

## Common First-Time Issues

1. **Missing Privacy Policy**: Required for TestFlight external testing
2. **Invalid Bundle ID**: Must match exactly between Xcode and App Store Connect
3. **Code Signing Errors**: Ensure team is selected and certificates are valid
4. **Build Processing Failed**: Check email from Apple for specific errors
5. **Missing App Icons**: 1024x1024 icon required for App Store

## Testing Reminders

- Test on physical device, not just simulator
- Test location permissions flow
- Test with actual GPS movement
- Test route building with real addresses
- Test on different iOS versions if possible
- Test on different device sizes (iPhone SE, iPhone Pro Max)

---

**Ready to Archive?** Open `ios/HudMap.xcworkspace` in Xcode and follow the guide in `TESTFLIGHT_GUIDE.md`

