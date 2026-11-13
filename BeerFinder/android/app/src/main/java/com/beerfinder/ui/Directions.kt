package com.beerfinder.ui

import android.net.Uri

/** Builds the URIs used to launch an external maps app for turn-by-turn directions. */
object Directions {

    /**
     * `geo:` intent URI. The OS offers any installed maps app (Google Maps, Waze, …).
     * Apple Maps is iOS-only and will not appear on Android.
     */
    fun geoUri(lat: Double, lon: Double, name: String): Uri =
        Uri.parse("geo:$lat,$lon?q=$lat,$lon(${Uri.encode(name)})")

    /** Fallback when no app handles `geo:` — opens Google Maps directions in a browser. */
    fun webUri(lat: Double, lon: Double): Uri =
        Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$lat,$lon")
}
