---
name: Expo media library in web preview
description: Native media-library access and browser previews in the Expo app.
---

For Expo routes that also render in a browser preview, load `expo-media-library` dynamically only inside the native device-access action, after checking `Platform.OS`. A static import can crash the web preview because its native module is unavailable there.

**Why:** The Expo preview workflow bundles web and native targets, but `expo-media-library` depends on a native module that is not present in the web runtime.

**How to apply:** Use this pattern for phone music scanning or other native-only MediaLibrary features. Keep the web route functional and explain that device files require the installed app.
