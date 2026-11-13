package com.beerfinder.data

import com.beerfinder.BuildConfig
import com.beerfinder.data.local.LocalVenueSource
import com.beerfinder.data.local.VenueDao
import com.beerfinder.data.local.VenueEntity
import com.beerfinder.data.remote.BeerFinderApi
import com.beerfinder.data.remote.RankedVenueDto
import java.io.IOException
import java.time.LocalTime

/** Result of a nearest-venue fetch, annotated with whether it came from cache. */
data class VenueResult(
    val venues: List<VenueEntity>,
    val fromCache: Boolean
)

/**
 * Single source of truth for ranked venues.
 *
 * In OFFLINE_DEMO builds the ranking is computed entirely on-device from bundled
 * data (no network) so the app works standalone on a real phone. Otherwise it is
 * network-first with a Room fallback: a connectivity failure ([IOException])
 * returns the last cached snapshot instead of crashing.
 */
class VenueRepository(
    private val api: BeerFinderApi,
    private val dao: VenueDao,
    private val offlineDemo: Boolean = BuildConfig.OFFLINE_DEMO
) {

    suspend fun getNearestVenues(
        lat: Double,
        lon: Double,
        wp: Double = 0.5,
        wd: Double = 0.5,
        padresActive: Boolean = false,
        centerOnUser: Boolean = false
    ): VenueResult {
        if (offlineDemo) {
            val now = LocalTime.now()
            val nowMinutes = now.hour * 60 + now.minute
            val entities = LocalVenueSource
                .ranked(lat, lon, padresActive, nowMinutes, wp, wd, centerOnUser)
                .map { it.toEntity() }
            dao.replaceAll(entities)
            return VenueResult(venues = entities, fromCache = false)
        }
        return try {
            val remote = api.getNearestVenues(lat, lon, wp, wd, venueType = "all", openNow = false)
            val entities = remote.map { it.toEntity() }
            dao.replaceAll(entities)
            VenueResult(venues = entities, fromCache = false)
        } catch (io: IOException) {
            VenueResult(venues = dao.getAll(), fromCache = true)
        }
    }

    private fun RankedVenueDto.toEntity() = VenueEntity(
        venueId = venueId,
        name = name,
        venueType = venueType,
        latitude = latitude,
        longitude = longitude,
        address = address,
        distanceMiles = distanceMiles,
        bearingDegrees = bearingDegrees,
        effectivePrice = effectivePrice,
        cheapestBeerName = cheapestBeerName,
        isPadresDeal = isPadresDeal,
        isOpen = isOpen,
        hoursLabel = hoursLabel,
        score = score
    )
}
