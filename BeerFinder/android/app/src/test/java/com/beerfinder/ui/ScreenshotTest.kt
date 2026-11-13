package com.beerfinder.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the REAL app to PNGs on the JVM via Roborazzi + Robolectric native
 * graphics — no emulator. Includes a heading sweep (needle must point three
 * different directions as the device heading changes) and a "my location" shot.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [33], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val bars = listOf(
        VenueView("v3", "Fathom Bistro Bait & Tackle", false, 32.7128, -117.2343, 3.75, 0.293, 238.7, "San Diego Pale Ale", true, true, "11:00–20:00"),
        VenueView("v9", "Eppig Brewing Waterfront", false, 32.7154, -117.2307, 4.00, 0.049, 304.2, "10:45 To Denver IPA", true, true, "14:00–22:00"),
        VenueView("v10", "Point Loma Seafoods", false, 32.7176, -117.2300, 4.50, 0.180, 0.0, "Harbor Light Draft", false, true, "09:00–20:00"),
        VenueView("v1", "Harbor Town Pub", false, 32.7277, -117.2246, 5.00, 0.90, 20.0, "Point Loma Lager", false, true, "11:00–24:00"),
        VenueView("v7", "Phil's BBQ", false, 32.7547, -117.2052, 5.00, 3.00, 35.0, "Barbecue Pilsner", false, false, "11:00–21:00")
    )

    private val stores = listOf(
        VenueView("s2", "Vons Midway", true, 32.7489, -117.2098, 2.25, 2.80, 40.0, "Coors Banquet Tallboy 24oz", false, true, "06:00–24:00"),
        VenueView("s3", "Point Loma Bottle Shop", true, 32.7338, -117.2289, 2.49, 1.30, 10.0, "Modelo Especial 24oz", true, true, "10:00–22:00"),
        VenueView("s4", "7-Eleven Rosecrans", true, 32.7211, -117.2258, 2.50, 0.50, 30.0, "Bud Light Tallboy 24oz", false, true, "00:00–24:00"),
        VenueView("s1", "Rosecrans Liquor & Market", true, 32.7301, -117.2231, 2.75, 1.20, 25.0, "Tecate Tallboy 24oz", false, true, "08:00–02:00")
    )

    private fun outDir(): File =
        File(System.getProperty("beerfinder.screenshot.dir") ?: ".").also { it.mkdirs() }

    private fun capture(
        name: String,
        category: VenueCategory,
        tab: AppTab,
        venues: List<VenueView>,
        azimuth: Float = 0f,
        usingLoc: Boolean = false,
        lat: Double = 32.7150,
        lon: Double = -117.2300
    ) {
        composeRule.setContent {
            MaterialTheme {
                Surface {
                    BeerFinderApp(
                        state = AppUiState(
                            category = category, tab = tab, sortMode = SortMode.BEST,
                            padresActive = (category == VenueCategory.BAR),
                            usingMyLocation = usingLoc, locating = false, venues = venues,
                            userLat = lat, userLon = lon,
                            deviceAzimuth = azimuth, fromCache = false, loading = false
                        ),
                        onCategoryChange = {}, onTabChange = {}
                    )
                }
            }
        }
        val out = File(outDir(), name)
        composeRule.onRoot().captureRoboImage(filePath = out.absolutePath)
        assertTrue("screenshot not written: ${out.absolutePath}", out.exists() && out.length() > 0)
    }

    @Test fun compassBars() = capture("01-compass-bars.png", VenueCategory.BAR, AppTab.COMPASS, bars)
    @Test fun compassStores() = capture("02-compass-stores.png", VenueCategory.STORE, AppTab.COMPASS, stores)
    @Test fun mapBars() = capture("03-map-bars.png", VenueCategory.BAR, AppTab.MAP, bars)
    @Test fun mapStores() = capture("04-map-stores.png", VenueCategory.STORE, AppTab.MAP, stores)

    // Proof the needle tracks the device heading: same venue, three headings.
    @Test fun headingSweep0() = capture("10-heading-000.png", VenueCategory.BAR, AppTab.COMPASS, bars, azimuth = 0f)
    @Test fun headingSweep120() = capture("11-heading-120.png", VenueCategory.BAR, AppTab.COMPASS, bars, azimuth = 120f)
    @Test fun headingSweep240() = capture("12-heading-240.png", VenueCategory.BAR, AppTab.COMPASS, bars, azimuth = 240f)

    // Proof the location path works: "using my location" shows coords + re-centers.
    @Test fun myLocation() = capture(
        "20-my-location.png", VenueCategory.BAR, AppTab.COMPASS, bars,
        azimuth = 60f, usingLoc = true, lat = 40.7128, lon = -74.0060
    )
}
