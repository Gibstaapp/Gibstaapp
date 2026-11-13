package com.beerfinder

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.room.Room
import com.beerfinder.compass.rememberDeviceAzimuth
import com.beerfinder.data.VenueRepository
import com.beerfinder.data.local.BeerFinderDatabase
import com.beerfinder.data.local.VenueEntity
import com.beerfinder.data.remote.NetworkModule
import com.beerfinder.ui.AppTab
import com.beerfinder.ui.AppUiState
import com.beerfinder.ui.BeerFinderApp
import com.beerfinder.ui.Directions
import com.beerfinder.ui.SortMode
import com.beerfinder.ui.VenueCategory
import com.beerfinder.ui.VenueView
import com.beerfinder.ui.sortVenues
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = Room.databaseBuilder(
            applicationContext,
            BeerFinderDatabase::class.java,
            "beerfinder.db"
        ).build()
        val repository = VenueRepository(NetworkModule.api, db.venueDao())

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    BeerFinderRoute(repository)
                }
            }
        }
    }
}

// Point Loma demo anchor (used until the user taps "use my location").
private const val LAT = 32.7150
private const val LON = -117.2300

private fun openDirections(context: Context, v: VenueView) {
    val geo = Directions.geoUri(v.latitude, v.longitude, v.name)
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, geo).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        val web = Directions.webUri(v.latitude, v.longitude)
        context.startActivity(Intent(Intent.ACTION_VIEW, web).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@SuppressLint("MissingPermission") // callers check the permission first
private fun fetchLocation(
    fused: FusedLocationProviderClient,
    onResult: (Double, Double) -> Unit,
    onFail: () -> Unit
) {
    fun tryLast() {
        fused.lastLocation
            .addOnSuccessListener { loc -> if (loc != null) onResult(loc.latitude, loc.longitude) else onFail() }
            .addOnFailureListener { onFail() }
    }
    fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
        .addOnSuccessListener { loc -> if (loc != null) onResult(loc.latitude, loc.longitude) else tryLast() }
        .addOnFailureListener { tryLast() }
}

@Composable
private fun BeerFinderRoute(repository: VenueRepository) {
    val context = LocalContext.current
    val azimuth by rememberDeviceAzimuth()

    var all by remember { mutableStateOf<List<VenueEntity>>(emptyList()) }
    var fromCache by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var category by remember { mutableStateOf(VenueCategory.BAR) }
    var tab by remember { mutableStateOf(AppTab.COMPASS) }
    var sortMode by remember { mutableStateOf(SortMode.BEST) }
    var padresActive by remember { mutableStateOf(false) }

    var userLat by remember { mutableStateOf(LAT) }
    var userLon by remember { mutableStateOf(LON) }
    var usingMyLocation by remember { mutableStateOf(false) }
    var locating by remember { mutableStateOf(false) }

    val fused = remember { LocationServices.getFusedLocationProviderClient(context) }
    val onLocation: (Double, Double) -> Unit = { la, lo ->
        userLat = la; userLon = lo; usingMyLocation = true; locating = false
    }
    val onLocationFail: () -> Unit = {
        locating = false
        Toast.makeText(context, "Couldn't get a location — is GPS/Location turned on?", Toast.LENGTH_LONG).show()
    }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) fetchLocation(fused, onLocation, onLocationFail)
        else { locating = false; Toast.makeText(context, "Location permission denied", Toast.LENGTH_SHORT).show() }
    }

    val useMyLocation: () -> Unit = {
        locating = true
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) fetchLocation(fused, onLocation, onLocationFail)
        else permLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    LaunchedEffect(padresActive, userLat, userLon, usingMyLocation) {
        loading = true
        val result = repository.getNearestVenues(
            userLat, userLon, padresActive = padresActive, centerOnUser = usingMyLocation
        )
        all = result.venues
        fromCache = result.fromCache
        loading = false
    }

    val filtered = all.map { it.toView() }.filter { it.isStore == (category == VenueCategory.STORE) }
    val venues = sortVenues(filtered, sortMode)

    BeerFinderApp(
        state = AppUiState(
            category = category,
            tab = tab,
            sortMode = sortMode,
            padresActive = padresActive,
            usingMyLocation = usingMyLocation,
            locating = locating,
            venues = venues,
            userLat = userLat,
            userLon = userLon,
            deviceAzimuth = azimuth,
            fromCache = fromCache,
            loading = loading
        ),
        onCategoryChange = { category = it },
        onTabChange = { tab = it },
        onSortChange = { sortMode = it },
        onPadresToggle = { padresActive = it },
        onUseMyLocation = useMyLocation,
        onVenueClick = { openDirections(context, it) }
    )
}

private fun VenueEntity.toView() = VenueView(
    id = venueId,
    name = name,
    isStore = venueType == "store",
    latitude = latitude,
    longitude = longitude,
    effectivePrice = effectivePrice,
    distanceMiles = distanceMiles,
    bearingDegrees = bearingDegrees,
    cheapestBeerName = cheapestBeerName,
    isPadresDeal = isPadresDeal,
    isOpen = isOpen,
    hoursLabel = hoursLabel
)
