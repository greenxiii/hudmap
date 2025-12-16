# TestFlight Preparation Guide

This guide will walk you through preparing your HudMap app for TestFlight distribution.

## Prerequisites

1. **Apple Developer Account**
   - Active Apple Developer Program membership ($99/year)
   - Access to [App Store Connect](https://appstoreconnect.apple.com)

2. **Development Environment**
   - macOS with Xcode installed
   - Valid code signing certificates
   - Provisioning profiles

## Step 1: App Store Connect Setup

### 1.1 Create App Record

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click **My Apps** → **+** → **New App**
3. Fill in the details:
   - **Platform**: iOS
   - **Name**: HudMap
   - **Primary Language**: English
   - **Bundle ID**: `com.hudmap.app` (must match your Xcode project)
   - **SKU**: A unique identifier (e.g., `hudmap-001`)
   - **User Access**: Full Access (or App Manager)

### 1.2 App Information

Fill in the required information:
- **Privacy Policy URL**: (Required for TestFlight) - You'll need to host a privacy policy
- **Category**: Navigation or Utilities
- **Description**: Brief description of your app
- **Keywords**: Relevant search terms
- **Support URL**: Your support website/email
- **Marketing URL**: (Optional)

### 1.3 App Privacy

1. Go to **App Privacy** section
2. Answer questions about data collection:
   - Location data: Yes (for navigation)
   - Data linked to user: No (if you don't collect user data)
   - Tracking: No (unless you use analytics)

## Step 2: Xcode Project Configuration

### 2.1 Update Version and Build Numbers

Your current settings:
- **Version (MARKETING_VERSION)**: 1.0
- **Build (CURRENT_PROJECT_VERSION)**: 1

For TestFlight, increment the build number for each upload:
- Version: 1.0 (or 1.0.1 for minor updates)
- Build: 1, 2, 3... (increment for each TestFlight build)

To update in Xcode:
1. Open `ios/HudMap.xcworkspace` in Xcode
2. Select the **HudMap** project in the navigator
3. Select the **HudMap** target
4. Go to **General** tab
5. Update **Version** and **Build** numbers

Or update directly in `project.pbxproj`:
```bash
# Update MARKETING_VERSION and CURRENT_PROJECT_VERSION
```

### 2.2 Configure Signing & Capabilities

1. In Xcode, select the **HudMap** target
2. Go to **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. Select your **Team** (your Apple Developer account)
5. Ensure **Bundle Identifier** is `com.hudmap.app`

### 2.3 Set Build Configuration to Release

1. In Xcode, go to **Product** → **Scheme** → **Edit Scheme**
2. Select **Run** → **Info** tab
3. Set **Build Configuration** to **Release**

### 2.4 Update Info.plist (if needed)

Your `Info.plist` already has:
- ✅ Location permission description
- ✅ App Transport Security settings
- ✅ Display name

Optional additions:
- **NSLocationAlwaysUsageDescription**: If you need background location
- **NSLocationAlwaysAndWhenInUseUsageDescription**: For background location

## Step 3: Build and Archive

### 3.1 Clean Build Folder

```bash
cd /Users/green/Sites/HudMap/ios
xcodebuild clean -workspace HudMap.xcworkspace -scheme HudMap
```

### 3.2 Install Pods (if needed)

```bash
cd /Users/green/Sites/HudMap/ios
pod install
```

### 3.3 Build for Release

**Option A: Using Xcode (Recommended)**

1. Open `ios/HudMap.xcworkspace` in Xcode
2. Select **Any iOS Device** or **Generic iOS Device** as the target (not a simulator)
3. Go to **Product** → **Archive**
4. Wait for the archive to complete
5. The **Organizer** window will open automatically

**Option B: Using Command Line**

```bash
cd /Users/green/Sites/HudMap/ios

# Build archive
xcodebuild archive \
  -workspace HudMap.xcworkspace \
  -scheme HudMap \
  -configuration Release \
  -archivePath build/HudMap.xcarchive \
  -destination generic/platform=iOS \
  CODE_SIGN_IDENTITY="Apple Development" \
  DEVELOPMENT_TEAM="YOUR_TEAM_ID"
```

Replace `YOUR_TEAM_ID` with your Apple Developer Team ID (found in App Store Connect → Users and Access → Keys).

## Step 4: Upload to TestFlight

### 4.1 Using Xcode Organizer

1. In the **Organizer** window (after archiving), select your archive
2. Click **Distribute App**
3. Select **App Store Connect**
4. Click **Next**
5. Select **Upload**
6. Click **Next**
7. Review options:
   - ✅ **Include bitcode** (if available)
   - ✅ **Upload symbols** (for crash reports)
8. Click **Next**
9. Select your distribution certificate and provisioning profile
10. Click **Next** → **Upload**
11. Wait for upload to complete (may take 10-30 minutes)

### 4.2 Using Command Line (xcrun altool or xcodebuild)

```bash
# Upload using xcodebuild
xcodebuild -exportArchive \
  -archivePath build/HudMap.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist
```

You'll need to create an `ExportOptions.plist` file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>uploadBitcode</key>
    <true/>
    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
```

### 4.3 Using Transporter App

1. Download **Transporter** from the Mac App Store
2. Export your archive as an `.ipa` file
3. Open Transporter
4. Drag and drop the `.ipa` file
5. Click **Deliver**

## Step 5: Process Build in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Navigate to **My Apps** → **HudMap**
3. Go to **TestFlight** tab
4. Wait for processing (usually 10-30 minutes)
5. Once processed, you'll see the build under **iOS Builds**

## Step 6: Set Up TestFlight Testing

### 6.1 Internal Testing (Up to 100 testers)

1. In TestFlight, go to **Internal Testing**
2. Click **+** to create a group (e.g., "Internal Testers")
3. Add testers (must be added as users in App Store Connect)
4. Select your build
5. Click **Start Testing**

### 6.2 External Testing (Up to 10,000 testers)

1. Go to **External Testing**
2. Click **+** to create a group
3. Add testers via email or public link
4. **Important**: First external build requires App Review (similar to App Store review)
   - Fill in "What to Test" information
   - Submit for review
   - Wait 24-48 hours for approval
5. After approval, subsequent builds can be distributed immediately

### 6.3 Invite Testers

- **Internal**: Add users in App Store Connect → Users and Access
- **External**: Send email invites or share public link

## Step 7: Testing Checklist

Before submitting to TestFlight, verify:

- [ ] App launches without crashes
- [ ] Location permissions work correctly
- [ ] Map displays correctly
- [ ] Route building works
- [ ] North arrow displays and rotates correctly
- [ ] App works on different iOS versions (if testing)
- [ ] App works on different device sizes
- [ ] No console errors in release build
- [ ] Performance is acceptable

## Common Issues and Solutions

### Issue: "No accounts with App Store Connect access"

**Solution**: 
- Ensure you're signed in with an Apple ID that has App Store Connect access
- Check your role in App Store Connect (needs App Manager or Admin)

### Issue: "Invalid Bundle Identifier"

**Solution**:
- Ensure Bundle ID in Xcode matches the one in App Store Connect
- Bundle ID must be unique and registered

### Issue: "Missing Compliance"

**Solution**:
- Answer export compliance questions in App Store Connect
- If using encryption, you may need to provide compliance documentation

### Issue: Build Processing Failed

**Solution**:
- Check email notifications from Apple
- Common causes: missing icons, invalid entitlements, code signing issues
- Review build logs in App Store Connect

### Issue: "Invalid Provisioning Profile"

**Solution**:
- Ensure you have a valid App Store distribution profile
- Xcode can auto-generate this if "Automatically manage signing" is enabled

## Version Management

For each new TestFlight build:

1. **Increment Build Number**: Always increment `CURRENT_PROJECT_VERSION` (1, 2, 3...)
2. **Version Number**: Only change `MARKETING_VERSION` for significant updates (1.0, 1.1, 2.0...)
3. **TestFlight**: Each build number can only be used once per version

## Next Steps After TestFlight

Once testing is complete:

1. **App Store Submission**: Use the same archive/process to submit to the App Store
2. **Production Release**: Follow similar steps but select "App Store" distribution
3. **Updates**: Use the same process for app updates

## Resources

- [App Store Connect Help](https://help.apple.com/app-store-connect/)
- [TestFlight Documentation](https://developer.apple.com/testflight/)
- [Xcode Documentation](https://developer.apple.com/documentation/xcode)

## Quick Command Reference

```bash
# Clean build
cd ios && xcodebuild clean -workspace HudMap.xcworkspace -scheme HudMap

# Install pods
cd ios && pod install

# Build for device (debug)
cd ios && xcodebuild -workspace HudMap.xcworkspace -scheme HudMap -configuration Debug -destination 'platform=iOS,id=DEVICE_ID'

# Archive (requires Xcode GUI or full command with signing)
# Best done through Xcode: Product → Archive
```

---

**Note**: The first TestFlight build for external testing requires App Review, which typically takes 24-48 hours. Internal testing builds are available immediately after processing.

