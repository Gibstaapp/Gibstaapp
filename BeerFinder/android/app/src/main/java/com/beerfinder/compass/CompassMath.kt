package com.beerfinder.compass

/**
 * Pure, side-effect-free compass angle math. Kept free of Android types so it
 * runs on the plain JVM unit-test classpath (see CompassMathTest).
 *
 * Angle convention: degrees, 0 = North, increasing clockwise.
 */
object CompassMath {

    /** Normalize any angle (incl. negative / >360) into the half-open range [0, 360). */
    fun normalizeAngle(deg: Float): Float = ((deg % 360f) + 360f) % 360f

    /**
     * Shortest signed rotation from [current] to [target] using shortest-arc logic.
     *
     *     ((target - current + 540) % 360) - 180   (with positive-modulo hardening)
     *
     * Result is in [-180, 180): positive = rotate clockwise, negative =
     * counter-clockwise. The exact antipode maps canonically to -180.
     * This is the value that prevents the needle from spinning "the long way"
     * when the heading wraps across North (e.g. 350 -> 10 is +20, not -340).
     */
    fun shortestDelta(current: Float, target: Float): Float =
        ((((target - current + 540f) % 360f) + 360f) % 360f) - 180f

    /**
     * Low-pass smoothing step toward [target] along the shortest arc. [factor]
     * in (0,1] controls responsiveness; small values damp sensor jitter.
     */
    fun smooth(current: Float, target: Float, factor: Float = 0.15f): Float {
        val delta = shortestDelta(current, target)
        return normalizeAngle(current + delta * factor)
    }

    /**
     * Angle at which to draw the needle: where [targetBearing] (observer->venue)
     * sits relative to the device's current [deviceAzimuth] heading. Normalized
     * to [0, 360). When the device points straight at the venue this is ~0.
     */
    fun relativeBearing(deviceAzimuth: Float, targetBearing: Float): Float =
        normalizeAngle(targetBearing - deviceAzimuth)
}
