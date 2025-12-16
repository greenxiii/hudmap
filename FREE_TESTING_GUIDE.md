# Free Testing Guide (No Paid Developer Account)

You can test your app on physical devices without a paid Apple Developer account ($99/year). Here are your options:

## Option 1: Free Apple Developer Account (Recommended)

A **free Apple Developer account** allows you to:
- ✅ Test on your own iPhone/iPad (up to 3 devices)
- ✅ Install directly via Xcode
- ✅ Test all features including GPS, location services, etc.
- ❌ No TestFlight distribution
- ❌ No App Store submission
- ❌ Provisioning profiles expire after 7 days (need to re-sign weekly)

### Setup Steps:

1. **Create Free Apple ID** (if you don't have one):
   - Go to [appleid.apple.com](https://appleid.apple.com)
   - Create a new Apple ID (or use existing)

2. **Sign in to Xcode**:
   - Open Xcode → Preferences (⌘,) → Accounts
   - Click **+** → Add Apple ID
   - Sign in with your Apple ID

3. **Configure Signing**:
   - Open `ios/HudMap.xcworkspace` in Xcode
   - Select **HudMap** project → **HudMap** target
   - Go to **Signing & Capabilities** tab
   - Check **Automatically manage signing**
   - Select your **Personal Team** (your Apple ID)
   - Xcode will automatically create a provisioning profile

4. **Connect Your Device**:
   - Connect iPhone/iPad via USB
   - Trust the computer on your device
   - In Xcode, select your device from the device dropdown (top toolbar)

5. **Build and Run**:
   - Click the **Play** button (⌘R) or Product → Run
   - First time: You may need to trust the developer on your device:
     - Settings → General → VPN & Device Management
     - Tap your Apple ID → Trust

### Limitations:

- **7-Day Expiration**: App will stop working after 7 days
- **Re-signing**: Need to rebuild and reinstall weekly
- **3 Device Limit**: Can register up to 3 devices per year
- **No Distribution**: Can't share with others easily

### Workaround for 7-Day Limit:

You can automate re-signing using a script, but the easiest is to just rebuild weekly:
```bash
# Just rebuild in Xcode when it expires
# Or use fastlane match (advanced)
```

---

## Option 2: iOS Simulator (Free, Limited)

The iOS Simulator is free but has limitations:

### Pros:
- ✅ Free, no account needed
- ✅ Fast iteration
- ✅ Multiple device sizes
- ✅ Multiple iOS versions

### Cons:
- ❌ **No real GPS/location** - Simulated location only
- ❌ **No compass/heading** - Can't test rotation features
- ❌ **Performance differs** from real device
- ❌ **No real-world testing** of location accuracy

### Using Simulator for Basic Testing:

1. **Open Simulator**:
   ```bash
   cd /Users/green/Sites/HudMap
   npm run ios
   ```

2. **Simulate Location**:
   - In Simulator: Features → Location → Custom Location
   - Or: Features → Location → City Run / City Bicycle Ride

3. **Note**: Your app's heading/rotation features won't work properly since the simulator doesn't have a real compass.

---

## Option 3: Ad Hoc Distribution (Free Account, Limited)

With a free account, you can create Ad Hoc builds for:
- Testing on your own devices
- Sharing with a few friends (if you register their device UDID)

### Steps:

1. **Get Device UDIDs**:
   - Connect device to Mac
   - Open Xcode → Window → Devices and Simulators
   - Select device → Copy Identifier (UDID)

2. **Register Devices** (in Xcode):
   - Xcode → Preferences → Accounts
   - Select your Apple ID → Manage Certificates
   - Register devices (up to 3 per year with free account)

3. **Create Ad Hoc Build**:
   - In Xcode: Product → Archive
   - Distribute App → Ad Hoc
   - Export as `.ipa` file
   - Install via iTunes/Finder or third-party tools

### Limitations:
- Still 7-day expiration
- Limited to 3 registered devices per year
- More complex setup

---

## Option 4: Third-Party Services (Some Free Tiers)

Some services offer free testing options:

### Firebase App Distribution (Free Tier)
- Free for small teams
- Requires Google account
- Can distribute to testers
- Still requires Apple Developer account for signing

### TestFlight Alternative Services
- Most require paid Apple Developer account
- Not recommended for free testing

---

## Recommended Approach for Your App

Since your app **requires GPS and compass** (heading/rotation), here's the best free testing strategy:

### Primary: Free Apple Developer Account + Physical Device

1. **Sign up for free Apple Developer account** (just use your Apple ID)
2. **Test on your own iPhone**:
   - Install via Xcode
   - Test all location features
   - Test rotation/heading
   - Test route building

3. **Weekly Re-signing**:
   - Set a reminder to rebuild every 7 days
   - Takes 2-3 minutes to rebuild and reinstall

### Secondary: Simulator for UI/Logic Testing

- Use simulator for:
  - UI layout testing
  - Code logic testing
  - Route rendering (with simulated locations)
  - General app flow

- Don't rely on simulator for:
  - GPS accuracy
  - Compass/heading
  - Real-world location behavior

---

## Quick Start: Free Account Testing

```bash
# 1. Ensure you're signed in to Xcode with Apple ID
# (Xcode → Preferences → Accounts)

# 2. Open project
cd /Users/green/Sites/HudMap
open ios/HudMap.xcworkspace

# 3. In Xcode:
# - Select your iPhone from device dropdown
# - Click Run (⌘R)
# - Trust developer on device if prompted
```

---

## When You Need Paid Account

Consider upgrading to paid Apple Developer account ($99/year) when:
- ✅ You want to distribute to many testers (TestFlight)
- ✅ You're ready to submit to App Store
- ✅ You need longer provisioning profiles
- ✅ You want to distribute to more than 3 devices
- ✅ You need App Store Connect features

---

## Cost Comparison

| Feature | Free Account | Paid Account ($99/year) |
|---------|-------------|------------------------|
| Test on own device | ✅ (3 devices) | ✅ (Unlimited) |
| TestFlight | ❌ | ✅ |
| App Store submission | ❌ | ✅ |
| Provisioning duration | 7 days | 1 year |
| Device registration | 3/year | Unlimited |
| Distribution | Limited | Full |

---

## Troubleshooting Free Account Issues

### "No accounts with App Store Connect access"
- This is normal for free accounts
- You can still build and run on your device
- Just ignore App Store Connect errors

### "Provisioning profile expired"
- Rebuild in Xcode (takes 2-3 minutes)
- Reinstall on device
- Happens every 7 days

### "Device not registered"
- Free accounts: Up to 3 devices per year
- Remove old devices in Xcode → Preferences → Accounts → Manage Certificates

### "Untrusted Developer"
- On device: Settings → General → VPN & Device Management
- Tap your Apple ID → Trust

---

## Summary

**Best free option**: Use a free Apple Developer account to test on your own iPhone. You'll need to rebuild weekly, but it's completely free and lets you test all features including GPS and compass.

**For your app specifically**: Since it requires real GPS and compass data, physical device testing with a free account is the only viable free option. The simulator won't work for testing rotation/heading features.

Would you like me to help you set up the free account testing, or create a script to automate the weekly re-signing process?
