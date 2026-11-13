plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.beerfinder"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.beerfinder"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Base URL of the FastAPI backend. 10.0.2.2 is the emulator host loopback.
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8000/\"")
        // When true, the app ranks bundled Point Loma data on-device and never
        // hits the network — so the debug APK works standalone on a real phone.
        buildConfigField("boolean", "OFFLINE_DEMO", "true")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Location (FusedLocationProvider)
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // Unit tests (JVM)
    testImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("androidx.room:room-testing:2.6.1")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("org.robolectric:robolectric:4.12.2")
    // Compose UI testing + screenshot capture (runs under Robolectric native graphics)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    // Roborazzi: device-free Compose screenshots on the JVM (handles Robolectric idling)
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.26.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.26.0")
}

// Forward a screenshot output directory into the unit-test JVM (used by ScreenshotTest),
// and tell Roborazzi to record images.
tasks.withType<Test>().configureEach {
    val dir = System.getProperty("beerfinder.screenshot.dir")
        ?: layout.buildDirectory.dir("screenshots").get().asFile.absolutePath
    systemProperty("beerfinder.screenshot.dir", dir)
    systemProperty("roborazzi.test.record", "true")
}
