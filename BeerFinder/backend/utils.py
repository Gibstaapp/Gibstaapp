import math

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees) in miles.
    """
    R = 3958.8  # Earth radius in miles

    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate initial compass bearing from (lat1, lon1) to (lat2, lon2) in degrees [0, 360).
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.atan2(y, x)
    bearing = (math.degrees(theta) + 360.0) % 360.0
    return bearing

def calculate_score(effective_price: float, distance_miles: float, wp: float, wd: float) -> float:
    """
    Score = (effective_price * wp) + (distance_miles * wd)
    Lower score is better.
    """
    return (effective_price * wp) + (distance_miles * wd)


def is_open_at(open_hour: float, close_hour: float, now_minutes: int) -> bool:
    """Return whether a venue is open at ``now_minutes`` (minutes since midnight).

    ``close_hour`` > 24 denotes a past-midnight close (e.g. 26 == 2 AM). A venue
    whose window spans >= 24h (e.g. 0..24) is always open.
    """
    open_m = int(round(open_hour * 60))
    close_m = int(round(close_hour * 60))
    if close_m - open_m >= 24 * 60:
        return True
    # Normalize into a 0..1440 clock, handling past-midnight wrap.
    close_wrapped = close_m % (24 * 60)
    if close_m <= 24 * 60 and close_wrapped > open_m % (24 * 60):
        # Same-day window [open, close).
        return open_m <= now_minutes < close_m
    # Wraps past midnight: open if after opening OR before (wrapped) close.
    return now_minutes >= (open_m % (24 * 60)) or now_minutes < close_wrapped


def hours_label(open_hour: float, close_hour: float) -> str:
    """Human-readable hours like '11:00–24:00' or '08:00–02:00'."""
    def fmt(h: float) -> str:
        hh = int(h) % 24 if h >= 24 else int(h)
        mm = int(round((h - int(h)) * 60))
        return f"{hh:02d}:{mm:02d}"
    # Keep 24:00 as a readable end-of-day marker rather than 00:00.
    end = "24:00" if abs(close_hour - 24.0) < 1e-9 else fmt(close_hour)
    return f"{fmt(open_hour)}–{end}"
