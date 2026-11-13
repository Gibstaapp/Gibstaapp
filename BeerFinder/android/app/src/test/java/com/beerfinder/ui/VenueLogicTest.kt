package com.beerfinder.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Pure-JVM tests for venue selection + sorting (no Android/Robolectric needed). */
class VenueLogicTest {

    private fun v(id: String, price: Double, dist: Double, open: Boolean) = VenueView(
        id = id, name = id, isStore = false, latitude = 32.7, longitude = -117.2,
        effectivePrice = price, distanceMiles = dist, bearingDegrees = 0.0,
        cheapestBeerName = "x", isPadresDeal = false, isOpen = open, hoursLabel = "11:00–24:00"
    )

    private val sample = listOf(
        v("best", 4.0, 1.0, open = true),      // first in incoming (BEST) order
        v("cheapest", 2.0, 5.0, open = true),
        v("closest", 6.0, 0.2, open = true)
    )

    @Test fun sortBestPreservesIncomingOrder() {
        assertEquals(listOf("best", "cheapest", "closest"), sortVenues(sample, SortMode.BEST).map { it.id })
    }

    @Test fun sortCheapestByPrice() {
        assertEquals(listOf("cheapest", "best", "closest"), sortVenues(sample, SortMode.CHEAPEST).map { it.id })
    }

    @Test fun sortClosestByDistance() {
        assertEquals(listOf("closest", "best", "cheapest"), sortVenues(sample, SortMode.CLOSEST).map { it.id })
    }

    @Test fun pickTargetPrefersFirstOpen() {
        val list = listOf(v("closed1", 1.0, 1.0, open = false), v("open1", 9.0, 9.0, open = true))
        assertEquals("open1", pickTarget(list)?.id)
    }

    @Test fun pickTargetFallsBackToFirstWhenAllClosed() {
        val list = listOf(v("a", 1.0, 1.0, open = false), v("b", 2.0, 2.0, open = false))
        assertEquals("a", pickTarget(list)?.id)
    }

    @Test fun pickTargetNullWhenEmpty() {
        assertNull(pickTarget(emptyList()))
    }
}
