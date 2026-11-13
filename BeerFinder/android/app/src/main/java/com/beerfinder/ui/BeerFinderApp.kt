package com.beerfinder.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BeerFinderApp(
    state: AppUiState,
    onCategoryChange: (VenueCategory) -> Unit,
    onTabChange: (AppTab) -> Unit,
    onSortChange: (SortMode) -> Unit = {},
    onPadresToggle: (Boolean) -> Unit = {},
    onUseMyLocation: () -> Unit = {},
    onVenueClick: (VenueView) -> Unit = {},
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 20.dp, start = 16.dp, end = 16.dp, bottom = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    "BeerFinder",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = onUseMyLocation, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                    Text(
                        when {
                            state.locating -> "📍 locating…"
                            state.usingMyLocation -> "📍 %.4f, %.4f · tap to refresh".format(state.userLat, state.userLon)
                            else -> "📍 Point Loma (demo) · tap to use my location"
                        },
                        style = MaterialTheme.typography.labelMedium
                    )
                }
                CategoryToggle(
                    selected = state.category,
                    onSelect = onCategoryChange,
                    modifier = Modifier.padding(top = 12.dp)
                )
                SortToggle(
                    selected = state.sortMode,
                    onSelect = onSortChange,
                    modifier = Modifier.padding(top = 8.dp)
                )
                FilterChip(
                    selected = state.padresActive,
                    onClick = { onPadresToggle(!state.padresActive) },
                    label = { Text(if (state.padresActive) "⚾ Padres won! — deals on" else "⚾ Padres win deal: off") },
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = state.tab == AppTab.COMPASS,
                    onClick = { onTabChange(AppTab.COMPASS) },
                    icon = { Text("🧭", fontSize = 20.sp) },
                    label = { Text(AppTab.COMPASS.label) }
                )
                NavigationBarItem(
                    selected = state.tab == AppTab.MAP,
                    onClick = { onTabChange(AppTab.MAP) },
                    icon = { Text("🗺", fontSize = 20.sp) },
                    label = { Text(AppTab.MAP.label) }
                )
            }
        }
    ) { inner ->
        Box(Modifier.padding(inner).fillMaxSize()) {
            when (state.tab) {
                AppTab.COMPASS -> CompassTab(
                    venues = state.venues,
                    deviceAzimuth = state.deviceAzimuth,
                    category = state.category,
                    fromCache = state.fromCache,
                    loading = state.loading,
                    onDirections = onVenueClick
                )
                AppTab.MAP -> MapTab(
                    venues = state.venues,
                    userLat = state.userLat,
                    userLon = state.userLon,
                    category = state.category,
                    fromCache = state.fromCache,
                    onVenueClick = onVenueClick
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategoryToggle(
    selected: VenueCategory,
    onSelect: (VenueCategory) -> Unit,
    modifier: Modifier = Modifier
) {
    val entries = VenueCategory.entries
    SingleChoiceSegmentedButtonRow(modifier = modifier) {
        entries.forEachIndexed { index, category ->
            SegmentedButton(
                selected = selected == category,
                onClick = { onSelect(category) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = entries.size)
            ) {
                Text(category.label)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SortToggle(
    selected: SortMode,
    onSelect: (SortMode) -> Unit,
    modifier: Modifier = Modifier
) {
    val entries = SortMode.entries
    SingleChoiceSegmentedButtonRow(modifier = modifier) {
        entries.forEachIndexed { index, mode ->
            SegmentedButton(
                selected = selected == mode,
                onClick = { onSelect(mode) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = entries.size)
            ) {
                Text(mode.label, fontSize = 13.sp)
            }
        }
    }
}
