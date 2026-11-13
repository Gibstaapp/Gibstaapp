# BeerFinder Android Client

Jetpack Compose client for the BeerFinder API (contract: `../contracts/api_spec.json`).

## Modules / key files
- `app/src/main/java/com/beerfinder/compass/CompassMath.kt` — pure shortest-arc
  azimuth math (JVM-testable; the audited needle logic).
- `app/src/main/java/com/beerfinder/compass/Compass.kt` — `rememberDeviceAzimuth()`
  Compose helper; registers the rotation-vector `SensorEventListener` on
  `ON_RESUME` and unregisters on `ON_PAUSE` **and** in `DisposableEffect.onDispose`
  (Pixel 8 battery safety).
- `app/src/main/java/com/beerfinder/data/remote/` — Retrofit API + DTOs locked to
  the contract.
- `app/src/main/java/com/beerfinder/data/local/` — Room entity/DAO/database.
- `app/src/main/java/com/beerfinder/data/VenueRepository.kt` — network-first with
  Room fallback on `IOException` (no crash on dropout).

## Build & test
This project has been **built and tested end-to-end** with Temurin JDK 21 +
Android SDK (android-34, build-tools 34.0.0) + Gradle 8.9:
`gradle -p android :app:testDebugUnitTest :app:assembleDebug` → **BUILD SUCCESSFUL**,
producing `app/build/outputs/apk/debug/app-debug.apk`. Unit tests all pass —
`CompassMathTest` 8/8, `VenueDaoTest` (Room DAO, Robolectric) 5/5,
`VenueRepositoryTest` (network-dropout fallback) 3/3.

To reproduce (with `ANDROID_HOME` pointing at an SDK):

```bash
cd android
gradle wrapper --gradle-version 8.9   # generate gradlew + wrapper jar (one time)
./gradlew :app:testDebugUnitTest      # runs CompassMathTest, VenueDaoTest, VenueRepositoryTest
./gradlew :app:assembleDebug          # compile the client
```

Point the client at the backend via `API_BASE_URL` in `app/build.gradle.kts`
(`http://10.0.2.2:8000/` reaches a host-run FastAPI server from the emulator).

The compass shortest-arc formula is additionally proven numerically by a Python
oracle that mirrors `CompassMath` case-for-case:
`../backend/tests/test_compass_oracle.py` (part of the green `pytest` suite).
