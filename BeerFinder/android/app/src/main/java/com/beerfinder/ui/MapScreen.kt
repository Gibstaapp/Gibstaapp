package com.beerfinder.ui

import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.hypot

private val MapFace = Color(0xFFEAF0E6)
private val RoadFill = Color(0xFFFFFFFF)
private val RoadEdge = Color(0xFFD8DED0)
private val UserBlue = Color(0xFF1A73E8)

/** One illustrative arterial, drawn by projecting its two endpoints. Approximate. */
private data class Road(val name: String, val lat1: Double, val lon1: Double, val lat2: Double, val lon2: Double)

private val POINT_LOMA_ROADS = listOf(
    Road("Rosecrans St", 32.7450, -117.2150, 32.7050, -117.2360),
    Road("Catalina Blvd", 32.7470, -117.2415, 32.7060, -117.2420),
    Road("Nimitz Blvd", 32.7450, -117.2300, 32.7395, -117.2140),
    Road("Scott St", 32.7300, -117.2295, 32.7120, -117.2325),
    Road("Sunset Cliffs Blvd", 32.7495, -117.2525, 32.7080, -117.2530)
)

@Composable
fun MapTab(
    venues: List<VenueView>,
    userLat: Double,
    userLon: Double,
    category: VenueCategory,
    fromCache: Boolean,
    onVenueClick: (VenueView) -> Unit,
    modifier: Modifier = Modifier
) {
    val proj = remember(venues, userLat, userLon) { MapProjection(venues, userLat, userLon) }

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Text(
            "${venues.size} ${category.label.lowercase()} near you",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            "schematic · not to scale · tap a venue for directions",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(12.dp))
        Box(
            Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(20.dp))
        ) {
            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(venues) {
                        detectTapGestures { pos ->
                            val w = size.width.toFloat(); val h = size.height.toFloat()
                            var best: VenueView? = null; var bestD = Float.MAX_VALUE
                            for (v in venues) {
                                val p = proj.project(v.latitude, v.longitude, w, h)
                                val d = hypot(pos.x - p.x, pos.y - p.y)
                                if (d < bestD) { bestD = d; best = v }
                            }
                            if (best != null && bestD <= 70f) onVenueClick(best)
                        }
                    }
            ) {
                drawMap(proj, venues, userLat, userLon)
            }
            if (fromCache) {
                Text(
                    "offline — cached",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp)
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Legend()
    }
}

@Composable
private fun Legend() {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        LegendDot(OpenGreen, "Open"); LegendDot(ClosedGray, "Closed"); LegendDot(UserBlue, "You")
        Spacer(Modifier.weight(1f))
        Text("⚾ = Padres deal", style = MaterialTheme.typography.labelMedium, color = PadresBrown)
    }
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp)) { Canvas(Modifier.fillMaxSize()) { drawCircle(color) } }
        Spacer(Modifier.size(6.dp)); Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

private fun DrawScope.drawMap(
    proj: MapProjection, venues: List<VenueView>, userLat: Double, userLon: Double
) {
    val w = size.width; val h = size.height
    drawRoundRect(color = MapFace, cornerRadius = CornerRadius(36f, 36f))

    // --- street layer (approximate, labeled) ---
    val roadLabelPaint = Paint().apply {
        isAntiAlias = true; textAlign = Paint.Align.CENTER; textSize = 22f
        color = Color(0xFF7A8571).toArgb()
    }
    for (road in POINT_LOMA_ROADS) {
        val a = proj.project(road.lat1, road.lon1, w, h)
        val b = proj.project(road.lat2, road.lon2, w, h)
        drawLine(RoadEdge, a, b, strokeWidth = 26f, cap = StrokeCap.Round)
        drawLine(RoadFill, a, b, strokeWidth = 18f, cap = StrokeCap.Round)
        // label near 35% along the road, nudged to stay on-canvas
        val lx = (a.x + (b.x - a.x) * 0.35f).coerceIn(70f, w - 70f)
        val ly = (a.y + (b.y - a.y) * 0.35f).coerceIn(40f, h - 20f)
        drawContext.canvas.nativeCanvas.drawText(road.name, lx, ly, roadLabelPaint)
    }

    val pricePaint = Paint().apply {
        isAntiAlias = true; textAlign = Paint.Align.CENTER; textSize = 30f
        color = Color(0xFF202124).toArgb(); isFakeBoldText = true
    }
    val namePaint = Paint().apply {
        isAntiAlias = true; textAlign = Paint.Align.CENTER; textSize = 22f
        color = Color(0xFF5F6368).toArgb()
    }
    val pillPaint = Paint().apply { isAntiAlias = true; color = Color.White.copy(alpha = 0.88f).toArgb() }

    fun pill(text: String, cx: Float, cy: Float, p: Paint) {
        val tw = p.measureText(text); val th = p.textSize
        drawContext.canvas.nativeCanvas.drawRoundRect(cx - tw / 2 - 8f, cy - th, cx + tw / 2 + 8f, cy + 8f, 10f, 10f, pillPaint)
        drawContext.canvas.nativeCanvas.drawText(text, cx, cy, p)
    }

    // pins first
    for (v in venues) {
        val p = proj.project(v.latitude, v.longitude, w, h)
        if (v.isPadresDeal) drawCircle(PadresGold, radius = 26f, center = p)
        drawCircle(if (v.isOpen) OpenGreen else ClosedGray, radius = 16f, center = p)
        drawCircle(Color.White, radius = 6f, center = p)
    }
    // labels on top
    for (v in venues) {
        val p = proj.project(v.latitude, v.longitude, w, h)
        val short = if (v.name.length > 14) v.name.take(13) + "…" else v.name
        pill(short, p.x, p.y + 40f, namePaint)
        pill("$${"%.2f".format(v.effectivePrice)}", p.x, p.y - 26f, pricePaint)
    }

    // user marker
    val u = proj.project(userLat, userLon, w, h)
    drawCircle(UserBlue.copy(alpha = 0.18f), radius = 44f, center = u)
    drawCircle(UserBlue, radius = 14f, center = u)
    drawCircle(Color.White, radius = 5f, center = u)
}
