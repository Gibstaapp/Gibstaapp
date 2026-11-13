"""Numerical oracle for the Android compass shortest-arc math.

This machine has no JVM/Gradle, so we cannot execute CompassMath.kt directly.
Instead we reimplement the EXACT Kotlin expression here in Python and assert
the wrap-around behavior. The Kotlin `CompassMathTest` mirrors these same
cases for the device-side run, so a green run here is evidence the formula the
Android client ships is correct.

Kotlin reference (android/.../CompassMath.kt):

    fun normalizeAngle(deg: Float): Float = ((deg % 360f) + 360f) % 360f

    fun shortestDelta(current: Float, target: Float): Float =
        ((((target - current + 540f) % 360f) + 360f) % 360f) - 180f
"""

import pytest


def normalize_angle(deg: float) -> float:
    """Mirror of Kotlin normalizeAngle -> [0, 360)."""
    return ((deg % 360.0) + 360.0) % 360.0


def shortest_delta(current: float, target: float) -> float:
    """Mirror of Kotlin shortestDelta -> [-180, 180).

    Positive result => rotate clockwise; negative => counter-clockwise. The
    exact antipode (180 deg away) maps canonically to -180.0.
    """
    return ((((target - current + 540.0) % 360.0) + 360.0) % 360.0) - 180.0


def test_delta_wraps_forward_across_north():
    # 350 -> 10 is a +20 clockwise nudge, not -340.
    assert shortest_delta(350.0, 10.0) == pytest.approx(20.0)


def test_delta_wraps_backward_across_north():
    # 10 -> 350 is a -20 counter-clockwise nudge, not +340.
    assert shortest_delta(10.0, 350.0) == pytest.approx(-20.0)


@pytest.mark.parametrize(
    "current,target,expected",
    [
        (0.0, 0.0, 0.0),
        (0.0, 90.0, 90.0),
        (0.0, 270.0, -90.0),
        (90.0, 80.0, -10.0),
        (0.0, 180.0, -180.0),  # antipode -> canonical -180 for this formula
        (180.0, 0.0, -180.0),
        (45.0, 46.0, 1.0),
        (359.0, 1.0, 2.0),
    ],
)
def test_delta_cases(current, target, expected):
    assert shortest_delta(current, target) == pytest.approx(expected)


def test_delta_always_in_half_open_range():
    for current in range(0, 360, 7):
        for target in range(0, 360, 11):
            d = shortest_delta(float(current), float(target))
            assert -180.0 <= d < 180.0


def test_delta_handles_negative_and_overflow_inputs():
    # Robustness: raw sensor azimuth can be negative or exceed 360.
    assert shortest_delta(-10.0, 10.0) == pytest.approx(20.0)
    assert shortest_delta(370.0, 390.0) == pytest.approx(20.0)


def test_normalize_angle_range():
    for deg in (-720.0, -181.0, -1.0, 0.0, 359.9, 360.0, 720.0):
        assert 0.0 <= normalize_angle(deg) < 360.0
