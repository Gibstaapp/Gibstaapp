package com.beerfinder.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas
import com.beerfinder.compass.CompassMath

internal val PadresBrown = Color(0xFF2F241D)
internal val PadresGold = Color(0xFFFFC425)
internal val OpenGreen = Color(0xFF2E7D32)
internal val ClosedGray = Color(0xFF9AA0A6)
private val NeedleRed = Color(0xFFD7263D)

/** Pick the venue the needle should point to: best-scored OPEN one, else best-scored. */
fun pickTarget(venues: List<VenueView>): VenueView? =
    venues.firstOrNull { it.isOpen } ?: venues.firstOrNull()

@Composable
fun CompassTab(
    venues: List<VenueView>,
    deviceAzimuth: Float,
    category: VenueCategory,
    fromCache: Boolean,
    loading: Boolean,
    onDirections: (VenueView) -> Unit = {},
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        if (loading) {
            Text("Finding the nearest cold one…")
            return@Column
        }
        val target = pickTarget(venues)
        if (target == null) {
            Text("No ${category.label.lowercase()} nearby")
            return@Column
        }

        val needle = CompassMath.relativeBearing(deviceAzimuth, target.bearingDegrees.toFloat())
        CompassDial(needleDegrees = needle, modifier = Modifier.size(220.dp))
        Spacer(Modifier.height(8.dp))
        Text(
            "your heading ${"%.0f".format(deviceAzimuth)}°  ·  venue ${"%.0f".format(target.bearingDegrees)}°",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            "(turn around — heading should change)",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(20.dp))
        VenueCard(target, fromCache, onDirections)
    }
}

@Composable
private fun VenueCard(v: VenueView, fromCache: Boolean, onDirections: (VenueView) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Text(
                    v.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.size(8.dp))
                OpenChip(v.isOpen)
            }
            Spacer(Modifier.height(2.dp))
            Text(
                "${if (v.isStore) "Store" else "Bar"} · ${v.hoursLabel}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "$${"%.2f".format(v.effectivePrice)}",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "  ·  ${"%.2f".format(v.distanceMiles)} mi away",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                "cheapest: ${v.cheapestBeerName}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (v.isPadresDeal) {
                Spacer(Modifier.height(12.dp))
                PadresBadge()
            }
            if (fromCache) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "offline — showing cached results",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { onDirections(v) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp)
            ) {
                Text("🧭  Directions", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
internal fun OpenChip(isOpen: Boolean) {
    val bg = if (isOpen) OpenGreen else ClosedGray
    Box(
        Modifier
            .background(bg, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            if (isOpen) "OPEN" else "CLOSED",
            color = Color.White,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
internal fun PadresBadge() {
    Box(
        modifier = Modifier
            .background(PadresBrown, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 6.dp)
    ) {
        Text(
            "⚾  PADRES GAME-DAY DEAL",
            color = PadresGold,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun CompassDial(needleDegrees: Float, modifier: Modifier = Modifier) {
    val ring = Color(0xFF9AA0A6)
    val face = Color(0xFFF4F5F7)
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2f
            val c = Offset(size.width / 2f, size.height / 2f)
            drawCircle(color = face, radius = r, center = c)
            drawCircle(color = ring, radius = r, center = c, style = Stroke(width = 6f))
            for (a in 0 until 360 step 90) {
                rotate(a.toFloat(), pivot = c) {
                    drawLine(
                        color = ring,
                        start = Offset(c.x, c.y - r),
                        end = Offset(c.x, c.y - r + 18f),
                        strokeWidth = 5f
                    )
                }
            }
            rotate(needleDegrees, pivot = c) {
                drawLine(
                    color = NeedleRed,
                    start = c,
                    end = Offset(c.x, c.y - r * 0.78f),
                    strokeWidth = 12f,
                    cap = StrokeCap.Round
                )
                drawLine(
                    color = ring,
                    start = c,
                    end = Offset(c.x, c.y + r * 0.34f),
                    strokeWidth = 8f,
                    cap = StrokeCap.Round
                )
            }
            drawCircle(color = NeedleRed, radius = 10f, center = c)
        }
        Text("N", Modifier.align(Alignment.TopCenter), fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Text("S", Modifier.align(Alignment.BottomCenter), fontSize = 14.sp)
        Text("E", Modifier.align(Alignment.CenterEnd), fontSize = 14.sp)
        Text("W", Modifier.align(Alignment.CenterStart), fontSize = 14.sp)
    }
}
