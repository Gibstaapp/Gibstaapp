"""Endpoint + contract-adherence tests for the real backend app.

Covers /venues/nearest (scoring, sort, Padres deal, venue_type filter, open/closed
hours), /status/padres and /debug/padres-win. Asserts strict adherence to the
RankedVenue schema in contracts/api_spec.json (v1.1).
"""

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

ANCHOR = {"lat": 32.7150, "lon": -117.2300}

RANKED_VENUE_FIELDS = {
    "venue_id", "name", "venue_type", "latitude", "longitude", "address",
    "distance_miles", "bearing_degrees", "effective_price", "cheapest_beer_name",
    "is_padres_deal", "is_open", "open_hour", "close_hour", "hours_label",
    "score", "beers",
}
BEER_FIELDS = {"beer_name", "base_price", "happy_hour_price", "game_day_deal"}


def _set_padres(active: bool):
    r = client.post("/debug/padres-win", params={"active": str(active).lower()})
    assert r.status_code == 200
    assert r.json() == {"active": active}


def _nearest(**overrides):
    params = {**ANCHOR, **overrides}
    r = client.get("/venues/nearest", params=params)
    assert r.status_code == 200
    return r.json()


def _find(body, venue_id):
    return next(v for v in body if v["venue_id"] == venue_id)


# --- Padres status endpoints ------------------------------------------------

def test_padres_status_shape():
    r = client.get("/status/padres")
    assert r.status_code == 200
    assert set(r.json().keys()) == {"active"}


def test_padres_toggle_roundtrip():
    _set_padres(True)
    assert client.get("/status/padres").json() == {"active": True}
    _set_padres(False)
    assert client.get("/status/padres").json() == {"active": False}


def test_padres_win_requires_active_param_422():
    assert client.post("/debug/padres-win").status_code == 422


# --- contract adherence -----------------------------------------------------

def test_each_venue_matches_contract_schema():
    _set_padres(False)
    for v in _nearest():
        assert set(v.keys()) == RANKED_VENUE_FIELDS
        assert v["distance_miles"] >= 0.0
        assert 0.0 <= v["bearing_degrees"] < 360.0
        assert v["effective_price"] >= 0.0
        assert v["venue_type"] in {"store", "bar"}
        assert isinstance(v["is_open"], bool)
        assert isinstance(v["hours_label"], str) and "–" in v["hours_label"]
        for b in v["beers"]:
            assert set(b.keys()) == BEER_FIELDS


def test_results_sorted_by_score_ascending():
    _set_padres(False)
    scores = [v["score"] for v in _nearest()]
    assert scores == sorted(scores)


def test_full_dataset_count():
    # 10 bars + 4 stores in the Point Loma fixture.
    assert len(_nearest()) == 14


# --- venue_type filtering ---------------------------------------------------

def test_type_filter_bar_returns_only_bars():
    body = _nearest(venue_type="bar")
    assert len(body) == 10
    assert all(v["venue_type"] == "bar" for v in body)


def test_type_filter_store_returns_only_stores():
    body = _nearest(venue_type="store")
    assert len(body) == 4
    assert all(v["venue_type"] == "store" for v in body)


def test_invalid_type_422():
    r = client.get("/venues/nearest", params={**ANCHOR, "venue_type": "nightclub"})
    assert r.status_code == 422


def test_stores_are_cheaper_than_bars():
    _set_padres(False)
    cheapest_store = min(v["effective_price"] for v in _nearest(venue_type="store"))
    cheapest_bar = min(v["effective_price"] for v in _nearest(venue_type="bar"))
    assert cheapest_store < cheapest_bar


def test_pure_price_overall_winner_is_a_store_tallboy():
    # Padres off, price-only ranking -> Vons $2.25 tallboy is the cheapest beer anywhere.
    _set_padres(False)
    winner = _nearest(wp=1.0, wd=0.0)[0]
    assert winner["venue_type"] == "store"
    assert winner["effective_price"] == pytest.approx(2.25)


def test_pure_price_bar_winner_is_pizza_port():
    _set_padres(False)
    winner = _nearest(wp=1.0, wd=0.0, venue_type="bar")[0]
    assert winner["name"] == "Pizza Port Ocean Beach"
    assert winner["effective_price"] == pytest.approx(4.00)


# --- Padres deal (incl. a store deal) ---------------------------------------

def test_padres_deal_applies_to_store():
    # s3 Point Loma Bottle Shop: Modelo $2.99 -> $2.49 when Padres win.
    _set_padres(False)
    assert _find(_nearest(venue_type="store"), "s3")["effective_price"] == pytest.approx(2.99)
    _set_padres(True)
    on = _find(_nearest(venue_type="store"), "s3")
    assert on["effective_price"] == pytest.approx(2.49)
    assert on["is_padres_deal"] is True
    _set_padres(False)


# --- open / closed hours ----------------------------------------------------

def test_is_open_computed_at_given_hour():
    # 23:00: Fathom (closes 20:00) closed; Harbor Town Pub (closes 24:00) open.
    body = _nearest(at_hour=23)
    assert _find(body, "v3")["is_open"] is False
    assert _find(body, "v1")["is_open"] is True


def test_open_now_filters_to_open_venues_at_11pm():
    # Open at 23:00: v1, v6 (bars to midnight) + s1, s2, s4 (late/24h stores) = 5.
    body = _nearest(at_hour=23, open_now=True)
    ids = {v["venue_id"] for v in body}
    assert ids == {"v1", "v6", "s1", "s2", "s4"}
    assert all(v["is_open"] for v in body)


def test_open_now_at_3am_only_24h_store():
    # 03:00: 7-Eleven (00-24) open; Rosecrans Liquor (closes 02:00) already closed.
    body = _nearest(at_hour=3, open_now=True)
    ids = {v["venue_id"] for v in body}
    assert ids == {"s4"}


def test_store_type_plus_open_now_at_1am_wraps_past_midnight():
    # 01:00, stores only, open now: Rosecrans Liquor (08-02 wraps) + 7-Eleven (24h).
    body = _nearest(venue_type="store", open_now=True, at_hour=1)
    ids = {v["venue_id"] for v in body}
    assert ids == {"s1", "s4"}
    assert all(v["venue_type"] == "store" and v["is_open"] for v in body)


def test_open_now_midafternoon_has_many():
    body = _nearest(at_hour=15, open_now=True)
    assert len(body) >= 10  # most places open mid-afternoon


def test_hours_label_formatting():
    body = _nearest()
    assert _find(body, "v1")["hours_label"] == "11:00–24:00"
    assert _find(body, "s1")["hours_label"] == "08:00–02:00"  # past-midnight close


def test_at_hour_out_of_range_422():
    r = client.get("/venues/nearest", params={**ANCHOR, "at_hour": 24})
    assert r.status_code == 422
