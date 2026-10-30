# Hazri (facemark-owner) recovered source

Rebuilt on 2026-10-30 after the original folder (C:\Users\ADMIN\OneDrive\Desktop\facial app\facemark-owner) was lost.

- Source files: replayed from 12 Claude Code session logs (Jul 28 to Oct 6, 2026). 115 files, no unresolved edits.
- Files deleted during development (old react-native-maps views, FieldVisits screen) were removed again.
- Icons, splash image and assets/models/facenet.tflite were extracted from the live APK (Hazri 1.0.0 build 14). Icons are the APK's largest sizes, so they are lower resolution than the originals.
- package.json was rebuilt from the logged install commands and pinned to Expo SDK 54. react-native-fast-tflite 3.0.1 and react-native-nitro-modules 0.37.1 match what was current when they were installed.
- app.json plugins match the live APK's embedded config exactly.
- Verified: `npx expo export --platform android` bundles cleanly, and 98% of the live app's user-facing text matches the rebuilt bundle.

Google Drive fix included: src/services/googleDriveService.js sends token requests to the google-token Edge Function, which adds the client secret server side. The client ID is now 395642880446-3888pgi1orq5m3326h02li6of89mb7qs (set in .env and the EAS "preview" environment).
