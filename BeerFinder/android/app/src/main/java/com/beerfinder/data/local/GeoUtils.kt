package com.beerfinder.data.local

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * On-device port of the backend geo/hours math (backend/utils.py) so the app can
 * rank venues from bundled data with no server. Kept in sync with the contract.
 */
object GeoUtils {
    const val EARTH_RADIUS_MILES = 3958.8

    fun haversineMiles(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return EARTH_RADIUS_MILES * 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
    }

    fun bearingDegrees(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val dLon = Math.toRadians(lon2 - lon1)
        val y = sin(dLon) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLon)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    /** close_hour > 24 denotes a past-midnight close (e.g. 26 == 2 AM). */
    fun isOpenAt(openHour: Double, closeHour: Double, nowMinutes: Int): Boolean {
        val openM = (openHour * 60).roundToInt()
        val closeM = (closeHour * 60).roundToInt()
        if (closeM - openM >= 24 * 60) return true
        val closeWrapped = closeM % (24 * 60)
        return if (closeM <= 24 * 60 && closeWrapped > openM % (24 * 60)) {
            nowMinutes in openM until closeM
        } else {
            nowMinutes >= (openM % (24 * 60)) || nowMinutes < closeWrapped
        }
    }

    fun hoursLabel(openHour: Double, closeHour: Double): String {
        fun fmt(h: Double): String {
            val hh = if (h >= 24) h.toInt() % 24 else h.toInt()
            val mm = ((h - h.toInt()) * 60).roundToInt()
            return "%02d:%02d".format(hh, mm)
        }
        val end = if (kotlin.math.abs(closeHour - 24.0) < 1e-9) "24:00" else fmt(closeHour)
        return "${fmt(openHour)}–$end"
    }
}
