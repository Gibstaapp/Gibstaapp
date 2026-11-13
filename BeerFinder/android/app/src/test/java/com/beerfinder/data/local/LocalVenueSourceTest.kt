package com.beerfinder.data.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM verification of the on-device ranking used by the offline/demo build.
 * Mirrors the backend's behavior so the standalone APK matches the server.
 */
class LocalVenueSourceTest {

    private val lat = 32.7150
    private val lon = -117.2300
    private val noon = 12 * 60

    @Test fun returnsFullDatasetSortedByScore() {
        val r = LocalVenueSource.ranked(lat, lon, padresActive = false, nowMinutes = noon)
        assertEquals(14, r.size)
        assertEquals(r.map { it.score }.sorted(), r.map { it.score })
    }

    @Test fun storesAreCheaperThanBars() {
        val r = LocalVenueSource.ranked(lat, lon, padresActive = false, nowMinutes = noon)
        val cheapestStore = r.filter { it.venueType == "store" }.minOf { it.effectivePrice }
        val cheapestBar = r.filter { it.venueType == "bar" }.minOf { it.effectivePrice }
        assertTrue("store $cheapestStore should be < bar $cheapestBar", cheapestStore < cheapestBar)
        assertEquals(2.25, cheapestStore, 1e-9) // Vons tallboy
    }

    @Test fun padresDealLowersStorePrice() {
        val off = LocalVenueSource.ranked(lat, lon, padresActive = false, nowMinutes = noon).first { it.venueId == "s3" }
        val on = LocalVenueSource.ranked(lat, lon, padresActive = true, nowMinutes = noon).first { it.venueId == "s3" }
        assertEquals(2.99, off.effectivePrice, 1e-9)
        assertEquals(2.49, on.effectivePrice, 1e-9)
        assertTrue(on.isPadresDeal)
    }

    @Test fun isOpenReflectsHours() {
        // 23:00 — Fathom (closes 20:00) closed, Harbor Town Pub (closes 24:00) open.
        val r = LocalVenueSource.ranked(lat, lon, padresActive = false, nowMinutes = 23 * 60)
        assertTrue(!r.first { it.venueId == "v3" }.isOpen)
        assertTrue(r.first { it.venueId == "v1" }.isOpen)
    }

    @Test fun centerOnUserPlacesVenuesNearby() {
        // A user far from Point Loma (NYC) with centerOnUser gets venues clustered
        // around them (small distances), not thousands of miles away.
        val nyLat = 40.7128; val nyLon = -74.0060
        val far = LocalVenueSource.ranked(nyLat, nyLon, false, noon, centerOnUser = false)
        val near = LocalVenueSource.ranked(nyLat, nyLon, false, noon, centerOnUser = true)
        assertTrue("far should be huge: ${far.first().distanceMiles}", far.minOf { it.distanceMiles } > 2000.0)
        assertTrue("near should be local: ${near.maxOf { it.distanceMiles }}", near.maxOf { it.distanceMiles } < 5.0)
    }

    @Test fun distanceAndBearingArePopulated() {
        val r = LocalVenueSource.ranked(lat, lon, padresActive = false, nowMinutes = noon)
        for (v in r) {
            assertTrue(v.distanceMiles >= 0.0)
            assertTrue(v.bearingDegrees in 0.0..360.0)
            assertTrue(v.hoursLabel.contains("–"))
        }
    }
}
