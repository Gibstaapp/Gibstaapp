package com.beerfinder.data.local

import com.beerfinder.data.remote.BeerDto
import com.beerfinder.data.remote.GameDayDealDto
import com.beerfinder.data.remote.RankedVenueDto

/**
 * On-device ranking from bundled data — a faithful port of the backend
 * crud.get_nearest_venues so the app works with no server (offline/demo).
 */
object LocalVenueSource {

    fun ranked(
        userLat: Double,
        userLon: Double,
        padresActive: Boolean,
        nowMinutes: Int,
        wp: Double = 0.5,
        wd: Double = 0.5,
        centerOnUser: Boolean = false
    ): List<RankedVenueDto> {
        // The dataset is a fixed Point Loma demo. When using the phone's real
        // location, shift the whole cluster so the venues appear scattered around
        // the user — realistic distances + a meaningful compass anywhere.
        val shiftLat: Double
        val shiftLon: Double
        if (centerOnUser) {
            shiftLat = userLat - LocalVenues.ALL.map { it.lat }.average()
            shiftLon = userLon - LocalVenues.ALL.map { it.lon }.average()
        } else {
            shiftLat = 0.0; shiftLon = 0.0
        }

        val out = LocalVenues.ALL.map { v ->
            val vLat = v.lat + shiftLat
            val vLon = v.lon + shiftLon
            val distance = GeoUtils.haversineMiles(userLat, userLon, vLat, vLon)
            val bearing = GeoUtils.bearingDegrees(userLat, userLon, vLat, vLon)
            val isOpen = GeoUtils.isOpenAt(v.openHour, v.closeHour, nowMinutes)

            var cheapest = Double.MAX_VALUE
            var cheapestName = ""
            var isPadres = false
            val beerDtos = v.beers.map { b ->
                val deal = if (b.padresTeam != null && b.padresPrice != null)
                    GameDayDealDto(b.padresTeam, b.padresPrice) else null

                var price = b.base
                var beerPadres = false
                if (b.happy != null && b.happy < price) price = b.happy
                if (padresActive && b.padresTeam == "Padres" && b.padresPrice != null && b.padresPrice <= price) {
                    price = b.padresPrice; beerPadres = true
                }
                if (price < cheapest) { cheapest = price; cheapestName = b.name; isPadres = beerPadres }
                BeerDto(b.name, b.base, b.happy, deal)
            }
            if (cheapest == Double.MAX_VALUE) cheapest = 0.0
            val score = cheapest * wp + distance * wd

            RankedVenueDto(
                venueId = v.id, name = v.name, venueType = v.type,
                latitude = vLat, longitude = vLon, address = v.address,
                distanceMiles = round3(distance), bearingDegrees = round2(bearing),
                effectivePrice = round2(cheapest), cheapestBeerName = cheapestName,
                isPadresDeal = isPadres, isOpen = isOpen,
                openHour = v.openHour, closeHour = v.closeHour,
                hoursLabel = GeoUtils.hoursLabel(v.openHour, v.closeHour),
                score = round4(score), beers = beerDtos
            )
        }
        return out.sortedBy { it.score }
    }

    private fun round2(x: Double) = Math.round(x * 100.0) / 100.0
    private fun round3(x: Double) = Math.round(x * 1000.0) / 1000.0
    private fun round4(x: Double) = Math.round(x * 10000.0) / 10000.0
}
