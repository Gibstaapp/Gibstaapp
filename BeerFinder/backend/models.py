from sqlalchemy import Column, String, Float, Integer, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base

class Venue(Base):
    __tablename__ = "venues"

    venue_id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    venue_type = Column(String, nullable=False, default="bar")  # "store" | "bar"
    open_hour = Column(Float, nullable=False, default=0.0)       # 24h, may be fractional
    close_hour = Column(Float, nullable=False, default=24.0)     # >24 => past-midnight close
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    address = Column(String, nullable=False)

    beers = relationship("Beer", back_populates="venue", cascade="all, delete-orphan")

class Beer(Base):
    __tablename__ = "beers"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    venue_id = Column(String, ForeignKey("venues.venue_id"), nullable=False)
    beer_name = Column(String, nullable=False)
    base_price = Column(Float, nullable=False)
    happy_hour_price = Column(Float, nullable=True)
    game_day_team = Column(String, nullable=True)
    game_day_deal_price = Column(Float, nullable=True)

    venue = relationship("Venue", back_populates="beers")
