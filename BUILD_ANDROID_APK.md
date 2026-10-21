# Build and install the Evil Spotify APK

This project includes a GitHub Actions workflow that builds a personal-use Android APK in the cloud. You do not need Android Studio or Android build tools on your computer.

## One-time setup

1. In Replit, open **Tools → Git** and connect this project to a GitHub repository.
2. Commit and push the project to the repository's default branch.
3. On GitHub, open the repository's **Actions** tab. If asked, enable GitHub Actions for the repository.

## Build an APK

1. In GitHub, open **Actions → Build Evil Spotify APK**.
2. Select **Run workflow** and run it from the default branch.
3. When the run finishes successfully, open the run and download the **Evil-Spotify-APK** artifact.
4. Unzip the download. The APK inside is named `Evil-Spotify.apk`.
5. Move the APK to your Android phone and open it to install. Android may ask you to allow installs from the app you used to open the file.
6. Open Evil Spotify, allow audio-file access, and tap **Find my MP3s**.

Put MP3 files in a location indexed by Android, such as **Music** or **Downloads**. The app scans the phone's audio library, then plays those files locally and saves playlists on the device.

## Notes

- This workflow builds a debug-signed APK for personal sideloading, not a Google Play release.
- The GitHub Actions run is started manually; each run produces a downloadable APK artifact that GitHub keeps for 14 days.
- Each cloud run creates a fresh debug signing key. To install a later build over an earlier one, you may need to uninstall the old app first. Uninstalling removes that app's local playlists.
- The build uses the Android permissions and background-audio settings in `artifacts/evil-music-player/app.json`.
