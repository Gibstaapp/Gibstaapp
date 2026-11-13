package com.beerfinder.ui

import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure-JVM tests for map projection orientation (north up, east right, in-bounds). */
class MapProjectionTest {

    private fun v(lat: Double, lon: Double) = VenueView(
        id = "x", name = "x", isStore = false, latitude = lat, longitude = lon,
        effectivePrice = 1.0, distanceMiles = 1.0, bearingDegrees = 0.0,
        cheapestBeerName = "x", isPadresDeal = false, isOpen = true, hoursLabel = "x"
    )

    private val w = 1000f
    private val h = 2000f
    private val venues = listOf(v(32.70, -117.25), v(32.76, -117.20))
    private val proj = MapProjection(venues, userLat = 32.73, userLon = -117.23)

    @Test fun higherLatitudeIsHigherOnScreen() {
        val north = proj.project(32.76, -117.23, w, h)
        val south = proj.project(32.70, -117.23, w, h)
        assertTrue("north y=${north.y} should be < south y=${south.y}", north.y < south.y)
    }

    @Test fun higherLongitudeIsFurtherRight() {
        val east = proj.project(32.73, -117.20, w, h)
        val west = proj.project(32.73, -117.25, w, h)
        assertTrue("east x=${east.x} should be > west x=${west.x}", east.x > west.x)
    }

    @Test fun pointsStayWithinPaddedCanvas() {
        for (vv in venues) {
            val p = proj.project(vv.latitude, vv.longitude, w, h)
            assertTrue("x in bounds: ${p.x}", p.x in 0f..w)
            assertTrue("y in bounds: ${p.y}", p.y in 0f..h)
        }
    }
}
