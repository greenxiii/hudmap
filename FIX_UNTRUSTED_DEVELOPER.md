# Fix "Untrusted Developer" Error

This error occurs when iOS doesn't trust the developer certificate used to sign the app. Here's how to fix it:

## Solution: Trust the Developer on Your Device

### Step 1: On Your iPhone/iPad

1. **Open Settings** app
2. Go to **General**
3. Scroll down and tap **VPN & Device Management** (or **Device Management** / **Profiles & Device Management** on older iOS versions)
4. You should see a section called **"Developer App"** or **"Enterprise App"**
5. Tap on your Apple ID/Developer name (e.g., "Your Name" or the team name)
6. Tap **Trust "[Your Name]"** or **Trust "[Team Name]"**
7. Confirm by tapping **Trust** in the popup

### Step 2: Try Running the App Again

After trusting the developer:
- The app should now launch without the "untrusted developer" error
- You may need to delete and reinstall the app if it was already installed

## Alternative: Rebuild and Reinstall

If the above doesn't work:

1. **In Xcode:**
   - Open `ios/HudMap.xcworkspace`
   - Select your device from the device dropdown (top toolbar)
   - Product → Clean Build Folder (⇧⌘K)
   - Product → Run (⌘R)

2. **First time on device:**
   - You'll see a popup on your device asking to trust the developer
   - Follow the steps above to trust it

## If You Don't See the Developer Profile

If you don't see the developer profile in Settings:

1. **Check Xcode Signing:**
   - Open `ios/HudMap.xcworkspace` in Xcode
   - Select **HudMap** project → **HudMap** target
   - Go to **Signing & Capabilities** tab
   - Ensure **"Automatically manage signing"** is checked
   - Select your **Team** (your Apple ID)
   - Make sure there are no signing errors

2. **Reconnect Device:**
   - Unplug and replug your device
   - Trust the computer on your device if prompted
   - Try building again

## For Simulator

If you're using the iOS Simulator, you shouldn't get this error. If you do:
- Clean build folder in Xcode
- Delete the app from simulator
- Rebuild and run

## Common Issues

### "No profiles for 'com.hudmap.app' were found"
- Make sure you're signed in to Xcode with your Apple ID
- Xcode → Preferences (⌘,) → Accounts → Add your Apple ID
- Then go back to Signing & Capabilities and select your team

### App expires after 7 days
- This is normal for free Apple Developer accounts
- Just rebuild and reinstall the app weekly
- Or upgrade to a paid Apple Developer account ($99/year)

