package com.beerfinder.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [VenueEntity::class], version = 1, exportSchema = false)
abstract class BeerFinderDatabase : RoomDatabase() {
    abstract fun venueDao(): VenueDao
}
