from pydantic import BaseModel, ConfigDict
from typing import List, Optional

class GameDayDealSchema(BaseModel):
    team: str
    deal_price: float

class BeerSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    beer_name: str
    base_price: float
    happy_hour_price: Optional[float] = None
    game_day_deal: Optional[GameDayDealSchema] = None

class VenueSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    venue_id: str
    name: str
    latitude: float
    longitude: float
    address: str
    beers: List[BeerSchema] = []


class RankedVenueSchema(BaseModel):
    venue_id: str
    name: str
    venue_type: str
    latitude: float
    longitude: float
    address: str
    distance_miles: float
    bearing_degrees: float
    effective_price: float
    cheapest_beer_name: str
    is_padres_deal: bool
    is_open: bool
    open_hour: float
    close_hour: float
    hours_label: str
    score: float
    beers: List[BeerSchema] = []

class PadresStatusResponse(BaseModel):
    active: bool
