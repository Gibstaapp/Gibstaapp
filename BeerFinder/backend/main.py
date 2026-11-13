from fastapi import FastAPI, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from contextlib import asynccontextmanager
import os

from backend.database import Base, engine, get_db
from backend.crud import seed_database_from_fixtures, get_nearest_venues
from backend.schemas import RankedVenueSchema, PadresStatusResponse

def init_db():
    Base.metadata.create_all(bind=engine)
    db = next(get_db())
    try:
        fixture_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures", "point_loma_venues.json")
        seed_database_from_fixtures(db, fixture_path)
    finally:
        db.close()

# Initialize DB on startup
init_db()

class AppState:
    padres_win_active: bool = False

app_state = AppState()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="BeerFinder API", version="1.0.0", lifespan=lifespan)


@app.get("/status/padres", response_model=PadresStatusResponse)
def get_padres_status():
    return {"active": app_state.padres_win_active}

@app.post("/debug/padres-win", response_model=PadresStatusResponse)
def set_padres_win(active: bool = Query(..., description="Toggle Padres win state")):
    app_state.padres_win_active = active
    return {"active": app_state.padres_win_active}

@app.get("/venues/nearest", response_model=List[RankedVenueSchema])
def get_nearest(
    lat: float = Query(32.7150, description="User latitude"),
    lon: float = Query(-117.2300, description="User longitude"),
    wp: float = Query(0.5, description="Price weight"),
    wd: float = Query(0.5, description="Distance weight"),
    venue_type: str = Query("all", pattern="^(store|bar|all)$", description="Filter: store | bar | all"),
    open_now: bool = Query(False, description="Only return venues open at the query time"),
    at_hour: Optional[int] = Query(None, ge=0, le=23, description="Override 'now' hour for is_open"),
    at_minute: int = Query(0, ge=0, le=59, description="Override 'now' minute for is_open"),
    db: Session = Depends(get_db)
):
    return get_nearest_venues(
        db=db,
        lat=lat,
        lon=lon,
        wp=wp,
        wd=wd,
        padres_win_active=app_state.padres_win_active,
        venue_type=venue_type,
        open_now=open_now,
        at_hour=at_hour,
        at_minute=at_minute,
    )
