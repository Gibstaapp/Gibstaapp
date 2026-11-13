package com.beerfinder.data.remote

import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/** Retrofit binding for the BeerFinder backend. Paths match contracts/api_spec.json. */
interface BeerFinderApi {

    @GET("venues/nearest")
    suspend fun getNearestVenues(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("wp") wp: Double = 0.5,
        @Query("wd") wd: Double = 0.5,
        @Query("venue_type") venueType: String = "all",
        @Query("open_now") openNow: Boolean = false
    ): List<RankedVenueDto>

    @GET("status/padres")
    suspend fun getPadresStatus(): PadresStatusDto

    @POST("debug/padres-win")
    suspend fun setPadresWin(@Query("active") active: Boolean): PadresStatusDto
}
