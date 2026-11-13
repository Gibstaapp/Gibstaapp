package com.beerfinder.ui

/** Which category the user is browsing. */
enum class VenueCategory(val label: String, val apiValue: String) {
    BAR("Bars", "bar"),
    STORE("Stores", "store")
}

/** Which tab is showing. */
enum class AppTab(val label: String) {
    COMPASS("Compass"),
    MAP("Map")
}

/** How to order venues (also decides which one the compass points to). */
enum class SortMode(val label: String) {
    BEST("Best"),       // backend composite score (price + distance), as received
    CHEAPEST("Cheapest"),
    CLOSEST("Closest")
}

/**
 * Order venues for the given [mode]. BEST preserves the incoming order (the
 * backend already sorted by composite score). Pure — unit-tested on the JVM.
 */
fun sortVenues(venues: List<VenueView>, mode: SortMode): List<VenueView> = when (mode) {
    SortMode.BEST -> venues
    SortMode.CHEAPEST -> venues.sortedBy { it.effectivePrice }
    SortMode.CLOSEST -> venues.sortedBy { it.distanceMiles }
}

/** Flat, Android-free view model for one venue (used by both tabs). */
data class VenueView(
    val id: String,
    val name: String,
    val isStore: Boolean,
    val latitude: Double,
    val longitude: Double,
    val effectivePrice: Double,
    val distanceMiles: Double,
    val bearingDegrees: Double,
    val cheapestBeerName: String,
    val isPadresDeal: Boolean,
    val isOpen: Boolean,
    val hoursLabel: String
)

/** Full stateless UI state for the app shell. [venues] is already filtered to [category]. */
data class AppUiState(
    val category: VenueCategory,
    val tab: AppTab,
    val sortMode: SortMode,
    val padresActive: Boolean,
    val usingMyLocation: Boolean,
    val locating: Boolean,
    val venues: List<VenueView>,
    val userLat: Double,
    val userLon: Double,
    val deviceAzimuth: Float,
    val fromCache: Boolean,
    val loading: Boolean
)
