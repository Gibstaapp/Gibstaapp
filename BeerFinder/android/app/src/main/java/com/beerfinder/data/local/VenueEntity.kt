package com.beerfinder.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Cached ranked-venue row. This is the offline fallback surface read when the
 * network is unavailable. The nested beer list is intentionally not persisted
 * here — the cache serves the ranked summary needed to keep the compass usable
 * during dropouts.
 */
@Entity(tableName = "venues")
data class VenueEntity(
    @PrimaryKey val venueId: String,
    val name: String,
    val venueType: String,
    val latitude: Double,
    val longitude: Double,
    val address: String,
    val distanceMiles: Double,
    val bearingDegrees: Double,
    val effectivePrice: Double,
    val cheapestBeerName: String,
    val isPadresDeal: Boolean,
    val isOpen: Boolean,
    val hoursLabel: String,
    val score: Double
)
