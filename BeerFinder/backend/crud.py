import json
import os
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.models import Venue, Beer
from backend.utils import (
    haversine_distance,
    calculate_bearing,
    calculate_score,
    is_open_at,
    hours_label,
)


def seed_database_from_fixtures(db: Session, fixture_path: str):
    if db.query(Venue).count() > 0:
        return
    if not os.path.exists(fixture_path):
        return

    with open(fixture_path, "r", encoding="utf-8") as f:
        venues_data = json.load(f)

    for item in venues_data:
        venue = Venue(
            venue_id=item["venue_id"],
            name=item["name"],
            venue_type=item.get("venue_type", "bar"),
            open_hour=float(item.get("open_hour", 0.0)),
            close_hour=float(item.get("close_hour", 24.0)),
            latitude=item["latitude"],
            longitude=item["longitude"],
            address=item["address"],
        )
        db.add(venue)
        for beer_item in item.get("beers", []):
            gdd = beer_item.get("game_day_deal")
            team = gdd.get("team") if gdd else None
            deal_price = gdd.get("deal_price") if gdd else None

            beer = Beer(
                venue_id=venue.venue_id,
                beer_name=beer_item["beer_name"],
                base_price=beer_item["base_price"],
                happy_hour_price=beer_item.get("happy_hour_price"),
                game_day_team=team,
                game_day_deal_price=deal_price,
            )
            db.add(beer)
    db.commit()


def get_nearest_venues(
    db: Session,
    lat: float,
    lon: float,
    wp: float,
    wd: float,
    padres_win_active: bool,
    venue_type: str = "all",
    open_now: bool = False,
    at_hour: Optional[int] = None,
    at_minute: int = 0,
):
    # Resolve the "now" used for open/closed evaluation.
    if at_hour is None:
        now = datetime.now()
        now_minutes = now.hour * 60 + now.minute
    else:
        now_minutes = (at_hour % 24) * 60 + (at_minute % 60)

    venues = db.query(Venue).all()
    results = []

    for venue in venues:
        if venue_type != "all" and venue.venue_type != venue_type:
            continue

        venue_open = is_open_at(venue.open_hour, venue.close_hour, now_minutes)
        if open_now and not venue_open:
            continue

        distance = haversine_distance(lat, lon, venue.latitude, venue.longitude)
        bearing = calculate_bearing(lat, lon, venue.latitude, venue.longitude)

        cheapest_price = float("inf")
        cheapest_beer_name = ""
        is_padres_deal = False

        beer_schemas = []
        for beer in venue.beers:
            gdd = None
            if beer.game_day_team and beer.game_day_deal_price is not None:
                gdd = {"team": beer.game_day_team, "deal_price": beer.game_day_deal_price}

            beer_schemas.append({
                "beer_name": beer.beer_name,
                "base_price": beer.base_price,
                "happy_hour_price": beer.happy_hour_price,
                "game_day_deal": gdd,
            })

            current_beer_price = beer.base_price
            beer_is_padres = False

            if beer.happy_hour_price is not None and beer.happy_hour_price < current_beer_price:
                current_beer_price = beer.happy_hour_price

            if padres_win_active and beer.game_day_team == "Padres" and beer.game_day_deal_price is not None:
                if beer.game_day_deal_price <= current_beer_price:
                    current_beer_price = beer.game_day_deal_price
                    beer_is_padres = True

            if current_beer_price < cheapest_price:
                cheapest_price = current_beer_price
                cheapest_beer_name = beer.beer_name
                is_padres_deal = beer_is_padres

        if cheapest_price == float("inf"):
            cheapest_price = 0.0

        score = calculate_score(cheapest_price, distance, wp, wd)

        results.append({
            "venue_id": venue.venue_id,
            "name": venue.name,
            "venue_type": venue.venue_type,
            "latitude": venue.latitude,
            "longitude": venue.longitude,
            "address": venue.address,
            "distance_miles": round(distance, 3),
            "bearing_degrees": round(bearing, 2),
            "effective_price": round(cheapest_price, 2),
            "cheapest_beer_name": cheapest_beer_name,
            "is_padres_deal": is_padres_deal,
            "is_open": venue_open,
            "open_hour": venue.open_hour,
            "close_hour": venue.close_hour,
            "hours_label": hours_label(venue.open_hour, venue.close_hour),
            "score": round(score, 4),
            "beers": beer_schemas,
        })

    results.sort(key=lambda x: x["score"])
    return results
