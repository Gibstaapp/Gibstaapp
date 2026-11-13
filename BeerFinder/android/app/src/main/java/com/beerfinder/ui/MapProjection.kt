package com.beerfinder.ui

import androidx.compose.ui.geometry.Offset

/**
 * Equirectangular projection fixed from the venue+user bounds (independent of
 * canvas size). North is up (higher latitude -> smaller y); east is right
 * (higher longitude -> larger x). Pure Kotlin so it is unit-testable on the JVM.
 */
internal class MapProjection(
    venues: List<VenueView>, userLat: Double, userLon: Double, private val pad: Float = 64f
) {
    private val minLat: Double; private val maxLat: Double
    private val minLon: Double; private val maxLon: Double

    init {
        val lats = venues.map { it.latitude } + userLat
        val lons = venues.map { it.longitude } + userLon
        val latSpan = ((lats.max() - lats.min()).takeIf { it > 1e-6 } ?: 0.01) * 1.20
        val lonSpan = ((lons.max() - lons.min()).takeIf { it > 1e-6 } ?: 0.01) * 1.20
        val midLat = (lats.min() + lats.max()) / 2; val midLon = (lons.min() + lons.max()) / 2
        minLat = midLat - latSpan / 2; maxLat = midLat + latSpan / 2
        minLon = midLon - lonSpan / 2; maxLon = midLon + lonSpan / 2
    }

    fun project(lat: Double, lon: Double, w: Float, h: Float): Offset {
        val x = pad + ((lon - minLon) / (maxLon - minLon)).toFloat() * (w - 2 * pad)
        val y = pad + ((maxLat - lat) / (maxLat - minLat)).toFloat() * (h - 2 * pad)
        return Offset(x, y)
    }
}
