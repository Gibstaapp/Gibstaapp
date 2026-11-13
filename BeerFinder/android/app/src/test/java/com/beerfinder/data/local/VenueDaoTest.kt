package com.beerfinder.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Room DAO behavior verified on the JVM via Robolectric + an in-memory database.
 * Covers insert, ranked read order, counting, and the atomic replaceAll snapshot.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class VenueDaoTest {

    private lateinit var db: BeerFinderDatabase
    private lateinit var dao: VenueDao

    private fun venue(id: String, score: Double) = VenueEntity(
        venueId = id,
        name = "Venue $id",
        venueType = "bar",
        latitude = 32.7150,
        longitude = -117.2300,
        address = "Addr $id",
        distanceMiles = score,
        bearingDegrees = 123.0,
        effectivePrice = 5.0,
        cheapestBeerName = "Lager",
        isPadresDeal = false,
        isOpen = true,
        hoursLabel = "11:00–24:00",
        score = score
    )

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            BeerFinderDatabase::class.java
        ).allowMainThreadQueries().build()
        dao = db.venueDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun insertAndReadBackRankedByScore() = runTest {
        dao.insertAll(listOf(venue("b", 3.0), venue("a", 1.0), venue("c", 2.0)))
        val all = dao.getAll()
        assertEquals(listOf("a", "c", "b"), all.map { it.venueId })
    }

    @Test
    fun countReflectsInserts() = runTest {
        assertEquals(0, dao.count())
        dao.insertAll(listOf(venue("a", 1.0), venue("b", 2.0)))
        assertEquals(2, dao.count())
    }

    @Test
    fun insertReplacesOnConflict() = runTest {
        dao.insertAll(listOf(venue("a", 5.0)))
        dao.insertAll(listOf(venue("a", 1.0)))
        val all = dao.getAll()
        assertEquals(1, all.size)
        assertEquals(1.0, all.first().score, 1e-9)
    }

    @Test
    fun replaceAllSwapsSnapshotAtomically() = runTest {
        dao.insertAll(listOf(venue("a", 1.0), venue("b", 2.0)))
        dao.replaceAll(listOf(venue("x", 9.0)))
        val all = dao.getAll()
        assertEquals(listOf("x"), all.map { it.venueId })
    }

    @Test
    fun clearEmptiesTable() = runTest {
        dao.insertAll(listOf(venue("a", 1.0)))
        dao.clear()
        assertEquals(0, dao.count())
    }
}
