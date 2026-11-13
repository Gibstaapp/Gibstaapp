package com.beerfinder.data

import com.beerfinder.data.local.VenueDao
import com.beerfinder.data.local.VenueEntity
import com.beerfinder.data.remote.BeerFinderApi
import com.beerfinder.data.remote.PadresStatusDto
import com.beerfinder.data.remote.RankedVenueDto
import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM verification of the audited network-dropout fallback: a connectivity
 * failure must yield the cached snapshot (fromCache=true) and never throw.
 */
class VenueRepositoryTest {

    /** In-memory fake standing in for a Room-backed DAO. */
    private class FakeDao : VenueDao {
        private val store = linkedMapOf<String, VenueEntity>()
        override suspend fun getAll(): List<VenueEntity> = store.values.sortedBy { it.score }
        override suspend fun insertAll(venues: List<VenueEntity>) {
            venues.forEach { store[it.venueId] = it }
        }
        override suspend fun clear() = store.clear()
        override suspend fun count(): Int = store.size
        override suspend fun replaceAll(venues: List<VenueEntity>) {
            clear(); insertAll(venues)
        }
    }

    private class OnlineApi(private val venues: List<RankedVenueDto>) : BeerFinderApi {
        override suspend fun getNearestVenues(
            lat: Double, lon: Double, wp: Double, wd: Double, venueType: String, openNow: Boolean
        ) = venues
        override suspend fun getPadresStatus() = PadresStatusDto(active = false)
        override suspend fun setPadresWin(active: Boolean) = PadresStatusDto(active = active)
    }

    private class OfflineApi : BeerFinderApi {
        override suspend fun getNearestVenues(
            lat: Double, lon: Double, wp: Double, wd: Double, venueType: String, openNow: Boolean
        ): List<RankedVenueDto> = throw IOException("network down")
        override suspend fun getPadresStatus(): PadresStatusDto = throw IOException("network down")
        override suspend fun setPadresWin(active: Boolean): PadresStatusDto = throw IOException("network down")
    }

    private fun dto(id: String, score: Double) = RankedVenueDto(
        venueId = id, name = "Venue $id", venueType = "bar", latitude = 32.7150, longitude = -117.2300,
        address = "addr", distanceMiles = score, bearingDegrees = 90.0,
        effectivePrice = 4.0, cheapestBeerName = "IPA", isPadresDeal = false,
        isOpen = true, openHour = 11.0, closeHour = 24.0, hoursLabel = "11:00–24:00",
        score = score, beers = emptyList()
    )

    @Test
    fun onlineFetchCachesAndReportsFresh() = runTest {
        val dao = FakeDao()
        val repo = VenueRepository(OnlineApi(listOf(dto("a", 1.0), dto("b", 2.0))), dao, offlineDemo = false)

        val result = repo.getNearestVenues(32.7150, -117.2300)

        assertFalse(result.fromCache)
        assertEquals(listOf("a", "b"), result.venues.map { it.venueId })
        assertEquals(2, dao.count()) // snapshot written through
    }

    @Test
    fun offlineFallsBackToCacheWithoutCrashing() = runTest {
        val dao = FakeDao()
        // Prime the cache as if a prior online call had succeeded.
        dao.insertAll(listOf(VenueEntity(
            venueId = "a", name = "Venue a", venueType = "bar", latitude = 32.7, longitude = -117.2,
            address = "addr", distanceMiles = 1.0, bearingDegrees = 90.0, effectivePrice = 4.0,
            cheapestBeerName = "IPA", isPadresDeal = false, isOpen = true, hoursLabel = "11:00–24:00",
            score = 1.0
        )))

        val repo = VenueRepository(OfflineApi(), dao, offlineDemo = false)
        val result = repo.getNearestVenues(32.7150, -117.2300)

        assertTrue(result.fromCache)
        assertEquals(listOf("a"), result.venues.map { it.venueId })
    }

    @Test
    fun offlineWithEmptyCacheReturnsEmptyNotCrash() = runTest {
        val repo = VenueRepository(OfflineApi(), FakeDao(), offlineDemo = false)
        val result = repo.getNearestVenues(32.7150, -117.2300)

        assertTrue(result.fromCache)
        assertTrue(result.venues.isEmpty())
    }
}
