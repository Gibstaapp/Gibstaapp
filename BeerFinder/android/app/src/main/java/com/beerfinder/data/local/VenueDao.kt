package com.beerfinder.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface VenueDao {

    /** Cached venues, ranked best-first (lowest score), matching API sort order. */
    @Query("SELECT * FROM venues ORDER BY score ASC")
    suspend fun getAll(): List<VenueEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(venues: List<VenueEntity>)

    @Query("DELETE FROM venues")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM venues")
    suspend fun count(): Int

    /** Atomically replace the cache with a fresh snapshot. */
    @Transaction
    suspend fun replaceAll(venues: List<VenueEntity>) {
        clear()
        insertAll(venues)
    }
}
