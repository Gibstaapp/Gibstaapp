package com.beerfinder.data.remote

import com.google.gson.annotations.SerializedName

/**
 * Wire DTOs. Field mapping is LOCKED to contracts/api_spec.json
 * (schemas: RankedVenue, Beer, GameDayDeal, PadresStatus). Do not add or rename
 * fields without a contract version bump.
 */

data class RankedVenueDto(
    @SerializedName("venue_id") val venueId: String,
    @SerializedName("name") val name: String,
    @SerializedName("venue_type") val venueType: String,
    @SerializedName("latitude") val latitude: Double,
    @SerializedName("longitude") val longitude: Double,
    @SerializedName("address") val address: String,
    @SerializedName("distance_miles") val distanceMiles: Double,
    @SerializedName("bearing_degrees") val bearingDegrees: Double,
    @SerializedName("effective_price") val effectivePrice: Double,
    @SerializedName("cheapest_beer_name") val cheapestBeerName: String,
    @SerializedName("is_padres_deal") val isPadresDeal: Boolean,
    @SerializedName("is_open") val isOpen: Boolean,
    @SerializedName("open_hour") val openHour: Double,
    @SerializedName("close_hour") val closeHour: Double,
    @SerializedName("hours_label") val hoursLabel: String,
    @SerializedName("score") val score: Double,
    @SerializedName("beers") val beers: List<BeerDto> = emptyList()
)

data class BeerDto(
    @SerializedName("beer_name") val beerName: String,
    @SerializedName("base_price") val basePrice: Double,
    @SerializedName("happy_hour_price") val happyHourPrice: Double? = null,
    @SerializedName("game_day_deal") val gameDayDeal: GameDayDealDto? = null
)

data class GameDayDealDto(
    @SerializedName("team") val team: String,
    @SerializedName("deal_price") val dealPrice: Double
)

data class PadresStatusDto(
    @SerializedName("active") val active: Boolean
)
