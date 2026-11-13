package com.beerfinder.compass

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import androidx.compose.runtime.State
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSensor
import org.robolectric.shadows.ShadowSensorManager

/**
 * Proves the compass PIPELINE end-to-end on the JVM: rememberDeviceAzimuth
 * registers a listener, and delivering a rotation-vector event actually moves
 * the exposed azimuth state (and keeps it in [0,360)). This is the wiring that
 * drives the needle — so a green run here is evidence the needle responds to
 * the sensor, independent of any physical device.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class SensorPipelineTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun azimuthUpdatesWhenRotationVectorEventArrives() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val shadow = shadowOf(sm)
        shadow.addSensor(ShadowSensor.newInstance(Sensor.TYPE_ROTATION_VECTOR))

        lateinit var azimuth: State<Float>
        composeRule.setContent { azimuth = rememberDeviceAzimuth() }
        composeRule.waitForIdle()

        val before = azimuth.value

        // Rotation vector for ~90° yaw about the vertical axis: (x,y,z,w).
        val event = ShadowSensorManager.createSensorEvent(4, Sensor.TYPE_ROTATION_VECTOR)
        event.values[0] = 0f
        event.values[1] = 0f
        event.values[2] = sin(Math.PI / 4).toFloat()
        event.values[3] = cos(Math.PI / 4).toFloat()

        // Several events so the low-pass smoothing converges toward the heading.
        repeat(30) { shadow.sendSensorEventToListeners(event) }
        composeRule.waitForIdle()

        val after = azimuth.value
        assertNotEquals("azimuth should change after a sensor event", before, after)
        assertTrue("azimuth normalized", after in 0f..360f)
    }
}
