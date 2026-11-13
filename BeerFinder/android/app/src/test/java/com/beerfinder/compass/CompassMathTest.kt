package com.beerfinder.compass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM unit tests for the compass shortest-arc math. These mirror the
 * backend Python oracle (backend/tests/test_compass_oracle.py) case-for-case,
 * so the formula is pinned identically on both sides of the contract.
 */
class CompassMathTest {

    private val eps = 1e-3f

    @Test
    fun deltaWrapsForwardAcrossNorth() {
        assertEquals(20f, CompassMath.shortestDelta(350f, 10f), eps)
    }

    @Test
    fun deltaWrapsBackwardAcrossNorth() {
        assertEquals(-20f, CompassMath.shortestDelta(10f, 350f), eps)
    }

    @Test
    fun deltaKnownCases() {
        assertEquals(0f, CompassMath.shortestDelta(0f, 0f), eps)
        assertEquals(90f, CompassMath.shortestDelta(0f, 90f), eps)
        assertEquals(-90f, CompassMath.shortestDelta(0f, 270f), eps)
        assertEquals(-10f, CompassMath.shortestDelta(90f, 80f), eps)
        assertEquals(-180f, CompassMath.shortestDelta(0f, 180f), eps) // antipode -> -180
        assertEquals(2f, CompassMath.shortestDelta(359f, 1f), eps)
    }

    @Test
    fun deltaHandlesNegativeAndOverflowInputs() {
        assertEquals(20f, CompassMath.shortestDelta(-10f, 10f), eps)
        assertEquals(20f, CompassMath.shortestDelta(370f, 390f), eps)
    }

    @Test
    fun deltaAlwaysInHalfOpenRange() {
        var current = 0
        while (current < 360) {
            var target = 0
            while (target < 360) {
                val d = CompassMath.shortestDelta(current.toFloat(), target.toFloat())
                assertTrue("delta out of range: $d", d >= -180f && d < 180f)
                target += 11
            }
            current += 7
        }
    }

    @Test
    fun normalizeAngleAlwaysInRange() {
        for (deg in floatArrayOf(-720f, -181f, -1f, 0f, 359.9f, 360f, 720f)) {
            val n = CompassMath.normalizeAngle(deg)
            assertTrue("normalized out of range: $n", n >= 0f && n < 360f)
        }
    }

    @Test
    fun smoothMovesTowardTargetAlongShortestArc() {
        // From 350 toward 10: should nudge upward past 360 wrap, staying near 350..360/0.
        val stepped = CompassMath.smooth(350f, 10f, factor = 0.5f)
        // Halfway along +20 arc from 350 is 360 -> normalized 0.
        assertEquals(0f, stepped, 0.5f)
    }

    @Test
    fun relativeBearingPointsForwardWhenAligned() {
        // Device heading 90, venue bearing 90 -> needle at 0 (dead ahead).
        assertEquals(0f, CompassMath.relativeBearing(90f, 90f), eps)
        // Venue due east of a north-facing device -> needle at 90.
        assertEquals(90f, CompassMath.relativeBearing(0f, 90f), eps)
    }
}
