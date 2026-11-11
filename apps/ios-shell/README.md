# Illumination iOS app (Capacitor shell)

A small native iPhone/iPad app that opens the Illumination suite running on the Raider. It is a
full-screen web view with native switches a web page can't reach, mainly **hiding the bar with the
up/down arrows and the checkmark above the keyboard**.

Nothing here changes how `apps/suite` builds or runs. The Home Screen web app and desktop browser
keep working as before. This folder has its own `package.json` and `node_modules`.

| File | What it is |
| --- | --- |
| `capacitor.config.ts` | App ID `com.gdebo.illumination`, name, server address, keyboard and status-bar settings |
| `app-url.json` | Default address (`default`) and the Tailscale one (`tailscale`) |
| `www/offline.html` | Shown when the Raider can't be reached ("Try again" button) |
| `ios/` | Xcode project made by `npx cap add ios` (builds only on a Mac, so on GitHub's Macs) |
| `scripts/make-ios-assets.mjs` | Remakes the app icon and dark launch screen from the Lumen icon |
| `../../.github/workflows/ios-build.yml` | Cloud build: unsigned `.ipa` now, TestFlight later |

The web side is `apps/suite/components/NativeShell.tsx`. It only runs inside the native app
(`window.Capacitor.isNativePlatform()`), hides the keyboard toolbar, keeps the status bar
transparent, and adds `.cap-native` to `<html>` so `globals.css` uses the same top spacing as the
Home Screen app. In Safari and the Home Screen app it does nothing.

## Everyday commands (on the Raider, in `apps/ios-shell`)

```powershell
npm install          # once
npm run sync         # after changing capacitor.config.ts, app-url.json, www/ or plugins
npm run icons        # after changing the Lumen icon
```

UI changes in `apps/suite` **don't** need a new app build. The app loads the live site, so a
normal `npm run prod` restart is enough. Rebuild the app only when this folder changes.

## 1. Build the app on GitHub

The workflow runs on GitHub's Macs, so the changes have to be pushed first. Public repos get
the Mac build time free.

1. Push to `main`. Any change under `apps/ios-shell/` starts a build on its own. Or go to
   **GitHub > Illumination-Intelligence > Actions > iOS build > Run workflow**. That form also
   lets you type a different app address for just that build.
2. Wait about 10 to 15 minutes for the **Unsigned .ipa (sideload)** job to turn green.
3. Open the run and download **Illumination-unsigned-ipa** under *Artifacts*. Unzip it to get
   `Illumination-unsigned.ipa`. Artifacts are kept for 30 days.

Note that the repo is public, so anyone signed in to GitHub can download the artifact. It holds no
secrets, only the app's address, which is a home-network or private Tailscale address that
nobody outside can reach.

## 2. Install it with Sideloadly (Windows, free Apple ID)

One-time setup on the Raider:

1. Install **iTunes** and **iCloud** from Apple's website, using the "Windows (64-bit)" downloads,
   **not** the Microsoft Store versions. Sideloadly needs their device drivers.
2. Install **Sideloadly** from <https://sideloadly.io>.
3. Plug in the iPhone and tap **Trust This Computer**.

Each install:

1. Open Sideloadly, drag in `Illumination-unsigned.ipa`, pick the iPhone, enter your Apple ID,
   and press **Start**. Enter the 2FA code if asked. Sideloadly signs the app with your free ID.
2. First time only, on the iPhone:
   - Go to **Settings > Privacy & Security > Developer Mode**, turn it on, and restart.
   - Go to **Settings > General > VPN & Device Management**, tap your Apple ID, and choose **Trust**.
   - When the app first asks to find devices on your local network, tap **Allow**. That's how it
     reaches the Raider at `192.168.1.114`.
3. Open **Illumination**.

Free Apple ID limits:

- **The app stops opening after 7 days.** Run Sideloadly again with the same `.ipa`. If you turn on
  Sideloadly's *Automatic refresh*, it re-signs over Wi-Fi while the Raider is on.
- Up to 3 sideloaded apps at once, and 10 new app IDs a week.
- No push notifications. Apple only allows those with the paid account.

The iPad works the same way. Plug it in and sideload the same `.ipa`.

## 3. Switch the address to Tailscale (use it away from home)

The default address is `http://192.168.1.114:3000`, which only works on the home Wi-Fi. The Raider
already serves the app privately over Tailscale with https:

```
https://illumination.shrimp-bitterling.ts.net  ->  http://127.0.0.1:3000   (tailnet only)
```

(`tailscale serve status` on the Raider shows this.) To use it:

1. Install the **Tailscale** app on the iPhone and sign in to the same account as the Raider.
2. Pick one way to set the address:
   - **For every build (recommended):** in **GitHub > Settings > Secrets and variables > Actions >
     Variables**, add `ILLUMINATION_APP_URL` = `https://illumination.shrimp-bitterling.ts.net`.
   - **Or change the default:** set `"default"` in `app-url.json` to the Tailscale address and push.
   - **Or just once:** type the address in the *Run workflow* form.
3. Build and sideload again.

ComfyUI and Ollama stay private either way. The app only talks to the suite on port 3000, and
Tailscale traffic never reaches the public internet. With https, the plain-http allowance below
isn't needed anymore. It's harmless, but you can remove it.

**Plain-http allowance:** `ios/App/App/Info.plist` sets `NSAllowsLocalNetworking`, which allows
http to private IPs and `.local` names only. iOS 17+ needs it for `http://192.168.1.114:3000`.
`server.cleartext` in the config is the Android switch, and it turns off by itself for https.

## 4. When you get the paid Apple Developer account ($99/yr)

1. Join at <https://developer.apple.com/programs/>. Approval takes a day or two.
2. In **App Store Connect > Apps > +**, create the app with bundle ID `com.gdebo.illumination`.
   You may need to register the ID first under *Certificates, IDs & Profiles > Identifiers*.
3. In **App Store Connect > Users and Access > Integrations > App Store Connect API**, create a key
   with the **Admin** role. Download `AuthKey_XXXX.p8` (you only get one chance), and note the
   **Key ID** and **Issuer ID**.
4. In **GitHub > Settings > Secrets and variables > Actions**:
   - Add these **secrets**:
     - `APPLE_TEAM_ID`: Team ID from developer.apple.com > Membership
     - `ASC_KEY_ID`
     - `ASC_ISSUER_ID`
     - `ASC_API_KEY_P8_BASE64`: the .p8 file as base64. In PowerShell:
       `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard`.
       Then paste it in, and delete the .p8 from Downloads once it's stored safely.
   - Add the **variable** `IOS_SIGNING_ENABLED` = `true`.
5. Run the workflow. The **Signed build to TestFlight** job signs the app with cloud-managed
   certificates, so you don't need a Mac, a .p12, or a profile. It then uploads the build. Apple
   takes about 5 to 15 minutes to process it.
6. Install **TestFlight** from the App Store on the iPhone and iPad. Add yourself under
   *App Store Connect > TestFlight > Internal Testing*, then install from TestFlight. Builds last 90
   days, and there's no 7-day re-sign.

Push notifications need extra setup later: an APNs key, the `@capacitor/push-notifications` plugin,
and the *Push Notifications* capability. **Face ID** (for example `@capgo/capacitor-native-biometric`)
also works with a free ID. Neither is installed yet.

## Keyboard and layout notes

- The **keyboard toolbar** (arrows and checkmark) is hidden. The Capacitor Keyboard plugin hides it
  by default on iOS, and `NativeShell.tsx` also calls `setAccessoryBarVisible({ isVisible: false })`.
- `Keyboard.resize` is **`none`**, which matches Safari. The web view stays full height and the
  keyboard slides over it, and `ViewportSync.tsx` already tracks the visible height through
  `visualViewport`. If a chat input ever ends up hidden behind the keyboard in the app, try
  `resize: 'native'`, which shrinks the whole web view instead. Run `npm run sync` and rebuild.
- The status bar is transparent over the page, the native version of `black-translucent`.
  `contentInset: 'never'` keeps `env(safe-area-inset-*)` behaving as it does in Safari.
