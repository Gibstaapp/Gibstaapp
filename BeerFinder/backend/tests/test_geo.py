"""Mathematical audit of backend.utils great-circle primitives.

The production haversine returns MILES (R = 3958.8 mi); these oracles use that
unit deliberately so they pin the exact behavior the API ships.
"""

import math

import pytest

from backend.utils import calculate_bearing, haversine_distance

R_MILES = 3958.8


def test_identical_points_zero_distance():
    assert haversine_distance(32.7150, -117.2300, 32.7150, -117.2300) == pytest.approx(0.0, abs=1e-6)


def test_one_degree_latitude():
    expected = R_MILES * math.radians(1.0)  # ~69.09 miles
    got = haversine_distance(0.0, 0.0, 1.0, 0.0)
    assert got == pytest.approx(expected, rel=1e-9)
    assert got == pytest.approx(69.09, abs=0.05)


def test_one_degree_longitude_at_equator():
    expected = R_MILES * math.radians(1.0)
    got = haversine_distance(0.0, 0.0, 0.0, 1.0)
    assert got == pytest.approx(expected, rel=1e-9)


def test_distance_is_symmetric():
    a = haversine_distance(32.7150, -117.2300, 32.7483, -117.2483)
    b = haversine_distance(32.7483, -117.2483, 32.7150, -117.2300)
    assert a == pytest.approx(b, rel=1e-12)


def test_antimeridian_is_short_not_long_way():
    # 179.9E to -179.9E is 0.2 degrees apart, not 359.8.
    got = haversine_distance(0.0, 179.9, 0.0, -179.9)
    expected = R_MILES * math.radians(0.2)
    assert got == pytest.approx(expected, rel=1e-6)


@pytest.mark.parametrize(
    "lat2,lon2,expected",
    [
        (1.0, 0.0, 0.0),     # due north
        (0.0, 1.0, 90.0),    # due east
        (-1.0, 0.0, 180.0),  # due south
        (0.0, -1.0, 270.0),  # due west
    ],
)
def test_cardinal_bearings_from_origin(lat2, lon2, expected):
    assert calculate_bearing(0.0, 0.0, lat2, lon2) == pytest.approx(expected, abs=1e-6)


def test_bearing_southwest_in_third_quadrant():
    got = calculate_bearing(0.0, 0.0, -1.0, -1.0)
    assert 180.0 < got < 270.0
    assert 0.0 <= got < 360.0
