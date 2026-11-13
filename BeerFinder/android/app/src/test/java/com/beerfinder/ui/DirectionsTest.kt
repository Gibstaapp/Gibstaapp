package com.beerfinder.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Locks the maps-intent URI format used for directions. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class DirectionsTest {

    @Test
    fun geoUriEmbedsCoordinatesAndEncodedLabel() {
        val uri = Directions.geoUri(32.7128, -117.2343, "Fathom Bistro Bait & Tackle")
        val s = uri.toString()
        assertTrue(s, s.startsWith("geo:32.7128,-117.2343?q=32.7128,-117.2343("))
        // The label must be URL-encoded (space + ampersand escaped).
        assertTrue(s, s.contains("Fathom%20Bistro%20Bait%20%26%20Tackle"))
    }

    @Test
    fun webFallbackIsGoogleMapsDirections() {
        val uri = Directions.webUri(32.7489, -117.2098)
        assertEquals(
            "https://www.google.com/maps/dir/?api=1&destination=32.7489,-117.2098",
            uri.toString()
        )
    }
}
