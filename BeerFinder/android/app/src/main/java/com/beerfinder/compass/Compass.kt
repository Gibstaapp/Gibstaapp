package com.beerfinder.compass

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/**
 * Compose-friendly device azimuth (degrees, 0 = North, clockwise), smoothed
 * along the shortest arc so the needle never spins the long way round.
 *
 * Robustness: prefers TYPE_ROTATION_VECTOR, falls back to accelerometer +
 * magnetometer (classic compass) when the rotation sensor is unavailable or
 * silent. Registered immediately AND on ON_RESUME (first-launch race), and
 * unregistered on ON_PAUSE and in onDispose (Pixel 8 battery safety).
 */
@Composable
fun rememberDeviceAzimuth(): State<Float> {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val sensorManager = remember {
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    }
    val azimuth = remember { mutableFloatStateOf(0f) }

    DisposableEffect(lifecycleOwner, sensorManager) {
        val rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val accelSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val magSensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)

        val rotationMatrix = FloatArray(9)
        val orientation = FloatArray(3)
        val gravity = FloatArray(3)
        val geomag = FloatArray(3)
        var haveGravity = false
        var haveGeomag = false

        fun publish() {
            SensorManager.getOrientation(rotationMatrix, orientation)
            val deg = CompassMath.normalizeAngle(
                Math.toDegrees(orientation[0].toDouble()).toFloat()
            )
            azimuth.floatValue = CompassMath.smooth(azimuth.floatValue, deg, factor = 0.25f)
        }

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                when (event.sensor?.type) {
                    Sensor.TYPE_ROTATION_VECTOR -> {
                        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                        publish()
                    }
                    Sensor.TYPE_ACCELEROMETER -> {
                        System.arraycopy(event.values, 0, gravity, 0, 3)
                        haveGravity = true
                        if (haveGeomag &&
                            SensorManager.getRotationMatrix(rotationMatrix, null, gravity, geomag)
                        ) publish()
                    }
                    Sensor.TYPE_MAGNETIC_FIELD -> {
                        System.arraycopy(event.values, 0, geomag, 0, 3)
                        haveGeomag = true
                        if (haveGravity &&
                            SensorManager.getRotationMatrix(rotationMatrix, null, gravity, geomag)
                        ) publish()
                    }
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }
        }

        fun start() {
            if (rotationSensor != null) {
                sensorManager.registerListener(listener, rotationSensor, SensorManager.SENSOR_DELAY_GAME)
            } else {
                accelSensor?.let { sensorManager.registerListener(listener, it, SensorManager.SENSOR_DELAY_GAME) }
                magSensor?.let { sensorManager.registerListener(listener, it, SensorManager.SENSOR_DELAY_GAME) }
            }
        }
        fun stop() = sensorManager.unregisterListener(listener)

        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> start()
                Lifecycle.Event.ON_PAUSE -> stop()
                else -> Unit
            }
        }

        lifecycleOwner.lifecycle.addObserver(observer)
        start() // register now; ON_RESUME may have already fired before this effect ran

        onDispose {
            stop()
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    return azimuth
}
