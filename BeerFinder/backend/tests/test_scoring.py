import pytest
from backend.utils import haversine_distance, calculate_bearing, calculate_score

def test_haversine_distance_same_point():
    dist = haversine_distance(32.7150, -117.2300, 32.7150, -117.2300)
    assert pytest.approx(dist, abs=1e-4) == 0.0

def test_haversine_distance_known_points():
    # Point Loma to Ocean Beach (approx ~2.5 to 3 miles)
    dist = haversine_distance(32.7150, -117.2300, 32.7483, -117.2483)
    assert 2.0 < dist < 4.0

def test_calculate_bearing():
    # Point directly north
    bearing_north = calculate_bearing(32.0, -117.0, 33.0, -117.0)
    assert pytest.approx(bearing_north, abs=1.0) == 0.0

def test_calculate_score():
    score = calculate_score(effective_price=4.00, distance_miles=2.0, wp=0.5, wd=0.5)
    # (4.0 * 0.5) + (2.0 * 0.5) = 2.0 + 1.0 = 3.0
    assert pytest.approx(score) == 3.0
