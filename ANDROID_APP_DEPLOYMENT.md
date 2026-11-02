# Install the Android app privately

This builds an installable APK for AndeSivaiah Chits and transfers it from the laptop to Android phones. It does **not** publish the app to Google Play. The APK uses the same Supabase project as the deployed website, so both clients read and write the same company records.

## 1. Prepare the Expo project

The app already has an internal Android APK profile in `apps/mobile/eas.json`, is linked to Expo project `07da6a48-54cf-44f5-aebe-ce4729e85f06`, and has its two Supabase client variables configured in the EAS `preview` environment.

1. Sign in to an Expo account (or create one) from PowerShell:

   ```powershell
   Set-Location .\apps\mobile
   npx eas-cli@latest login
   ```

2. The project link is already set in `app.json`; no starter project or additional EAS project is needed. To check it after logging in, run:

   ```powershell
   npx eas-cli@latest init
   ```

   The project ID is already recorded in `app.json`. Keep it in the repository so future builds use the same Expo project and Android signing key.

## 2. Add the Supabase connection for the build

EAS cloud builds do not use your laptop's ignored `.env` file. The following values have already been added to this Expo project's **preview** environment. If the project is recreated or the Supabase project changes, update them in **Project settings → Environment variables**:

| Name | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | The same Supabase project URL used by the deployed website |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The matching Supabase anon/public key |

These `EXPO_PUBLIC_` values are included in the app bundle and can be read from the installed app. Use only the anon/public key; never add the Supabase service-role key. Expo documents the [EAS environment setup](https://docs.expo.dev/eas/environment-variables/manage/) and [build-time environment use](https://docs.expo.dev/eas/environment-variables/usage/).

## 3. Build the APK

From `apps/mobile`, run:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

On the first build, allow EAS to generate and manage the Android signing key. Keep using this same Expo project for future builds; the existing `autoIncrement` setting raises the Android build number so a newer APK can update the installed app.

When the build completes, open the build page shown by the CLI and download the `.apk` file to the laptop. The profile is configured for internal APK distribution, which is directly installable on Android. Expo's [APK build guide](https://docs.expo.dev/build-reference/apk/) and [internal distribution guide](https://docs.expo.dev/build/internal-distribution/) describe this flow.

## 4. Transfer and install on the phone

1. Connect the phone to the laptop with USB and select **File transfer** on the phone.
2. Copy the downloaded `.apk` into the phone's **Downloads** folder and disconnect the USB cable.
3. On the phone, open **Files → Downloads**, tap the APK, review Android's install prompt, and tap **Install**. If Android asks, allow Files to install apps from this source for this installation.
4. Open **AndeSivaiah Chits**, sign in with the staff account, and verify the website and app show the same test member/payment data.

Android may show an install warning because the APK was installed directly rather than through Play Store. This is expected for a private APK. Share the APK only with trusted staff; anyone holding the file can install that app build.

## Cost and publishing

No Play Store listing or Play Developer account is needed for direct APK installation. Expo's [current pricing page](https://expo.dev/pricing) lists up to 15 Android and 15 iOS builds on the Free plan, with a low-priority queue. This is enough for a small number of private build iterations; check the live plan limits before building. Do not enable a paid EAS plan or paid overage for this project unless the company chooses to.

## Updating the installed app

Make the code change, then repeat the build command above and copy the new APK to the phone. Because the package name, EAS project and signing key stay the same and the build number increments, Android can install the APK as an update. Keep `apps/mobile/eas.json` and the EAS project linkage; do not create a new signing key for each release.

If the build fails, check that the two `EXPO_PUBLIC_SUPABASE_*` variables exist in EAS's **preview** environment, then review the build log on the EAS build page. Local Expo Go and the installed APK are separate: use the APK to check native device features such as saving receipt images through Android's folder picker.

Receipt Chat now hands the actual preview PNG and its caption to WhatsApp for the member's saved number. It does not just open a text-only `wa.me` link or save a separate image first. This uses the native `react-native-share` module, so install a newly built APK to use direct-to-member sharing; Expo Go does not contain this added native module and falls back to its regular image share sheet. WhatsApp opens the prepared receipt for review, and the user still taps **Send**.

## New updates and installations

Use this process whenever you change the app and want the installed phone app to receive the changes. This project is not configured for over-the-air updates, so create and install a new APK for each app update.

### Update an app that is already installed

1. Save the latest changes in the repository and make sure they build successfully.
2. In PowerShell, go to the mobile app folder and start a new APK build:

   ```powershell
   Set-Location C:\Users\HP\Downloads\sas-chits-system\apps\mobile
   npx eas-cli@latest build --platform android --profile preview
   ```

3. When EAS finishes, download the new APK from its build page to the laptop.
4. Copy the APK to the phone over USB (or download it on the phone), then open it from **Files → Downloads** and tap **Install**. Android installs it over the existing app and keeps its local sign-in session and saved settings.

The project is configured to increment the Android build number for each EAS build. Keep the same Expo project ID, Android package name (`com.saschits.app`), and EAS-managed signing key. Do not uninstall the existing app before installing an update; changing the signing key or package name prevents Android from updating that installation.

If the change adds or updates a native package, permission, or app configuration, a new APK build is required. The steps above create that build as well.

### Install on another phone

Use the same build command and share that APK with the other phone. On first installation, open the APK from **Files → Downloads**, allow that source to install apps if Android asks, and tap **Install**. The other phone can sign in with its own staff account; company data remains in the shared Supabase project.

### First-time setup versus routine updates

- **First install:** build an APK, transfer it, and install it from Files.
- **Routine app update:** build a new APK and install it over the existing app; keep its package name, EAS project and signing key.
- **Website update:** deploy the website separately through Vercel. That does not update the installed phone app.
