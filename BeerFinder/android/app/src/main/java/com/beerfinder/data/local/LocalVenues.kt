package com.beerfinder.data.local

/** Bundled Point Loma dataset (mirrors fixtures/point_loma_venues.json) for offline/demo use. */
data class LocalBeer(
    val name: String,
    val base: Double,
    val happy: Double? = null,
    val padresTeam: String? = null,
    val padresPrice: Double? = null
)

data class LocalVenue(
    val id: String,
    val name: String,
    val type: String,       // "bar" | "store"
    val openHour: Double,
    val closeHour: Double,
    val lat: Double,
    val lon: Double,
    val address: String,
    val beers: List<LocalBeer>
)

object LocalVenues {
    val ALL: List<LocalVenue> = listOf(
        LocalVenue("v1", "Harbor Town Pub", "bar", 11.0, 24.0, 32.7277, -117.2246, "1125 Rosecrans St, San Diego, CA 92106",
            listOf(LocalBeer("Point Loma Lager", 7.0, 5.0, "Padres", 4.0), LocalBeer("IPA Draft", 8.0, 6.0))),
        LocalVenue("v2", "The Loma Club", "bar", 11.0, 22.0, 32.7354, -117.2163, "2960 Truxtun Rd, San Diego, CA 92106",
            listOf(LocalBeer("Liberty Station Amber", 7.5, 5.5, "Padres", 4.5))),
        LocalVenue("v3", "Fathom Bistro Bait & Tackle", "bar", 11.0, 20.0, 32.7128, -117.2343, "1776 Shelter Island Dr, San Diego, CA 92106",
            listOf(LocalBeer("San Diego Pale Ale", 6.5, 4.5, "Padres", 3.75))),
        LocalVenue("v4", "Jimmy's Famous American Tavern", "bar", 11.0, 23.0, 32.7242, -117.2288, "1733 Anchorage Ln, San Diego, CA 92106",
            listOf(LocalBeer("Famous House Blonde", 8.0, 6.0, "Padres", 5.0))),
        LocalVenue("v5", "Bay City Brewing Co.", "bar", 12.0, 22.0, 32.7562, -117.2081, "3760 Hancock St, San Diego, CA 92110",
            listOf(LocalBeer("Juicatronic IPA", 7.0, 5.0, "Padres", 4.0))),
        LocalVenue("v6", "Pizza Port Ocean Beach", "bar", 11.0, 24.0, 32.7483, -117.2483, "1956 Bacon St, San Diego, CA 92107",
            listOf(LocalBeer("Swami's IPA", 6.0, 4.0, "Padres", 3.5))),
        LocalVenue("v7", "Phil's BBQ", "bar", 11.0, 21.0, 32.7547, -117.2052, "3750 Sports Arena Blvd, San Diego, CA 92110",
            listOf(LocalBeer("Barbecue Pilsner", 6.5, 5.0))),
        LocalVenue("v8", "Mitch's Seafood", "bar", 11.0, 21.0, 32.7245, -117.2272, "1403 Scott St, San Diego, CA 92106",
            listOf(LocalBeer("Fisherman IPA", 7.5, 5.5, "Padres", 4.25))),
        LocalVenue("v9", "Eppig Brewing Waterfront Brewery", "bar", 14.0, 22.0, 32.7154, -117.2307, "2817 Dickens St, San Diego, CA 92106",
            listOf(LocalBeer("10:45 To Denver IPA", 7.5, 5.0, "Padres", 4.0))),
        LocalVenue("v10", "Point Loma Seafoods", "bar", 9.0, 20.0, 32.7176, -117.2300, "2805 Emerson St, San Diego, CA 92106",
            listOf(LocalBeer("Harbor Light Draft", 6.0, 4.5))),
        LocalVenue("s1", "Rosecrans Liquor & Market", "store", 8.0, 26.0, 32.7301, -117.2231, "1201 Rosecrans St, San Diego, CA 92106",
            listOf(LocalBeer("Tecate Tallboy 24oz", 2.75))),
        LocalVenue("s2", "Vons Midway", "store", 6.0, 24.0, 32.7489, -117.2098, "3912 Rosecrans St, San Diego, CA 92110",
            listOf(LocalBeer("Coors Banquet Tallboy 24oz", 2.25))),
        LocalVenue("s3", "Point Loma Bottle Shop", "store", 10.0, 22.0, 32.7338, -117.2289, "2690 Historic Decatur Rd, San Diego, CA 92106",
            listOf(LocalBeer("Modelo Especial 24oz", 2.99, null, "Padres", 2.49))),
        LocalVenue("s4", "7-Eleven Rosecrans", "store", 0.0, 24.0, 32.7211, -117.2258, "1365 Rosecrans St, San Diego, CA 92106",
            listOf(LocalBeer("Bud Light Tallboy 24oz", 2.50)))
    )
}
