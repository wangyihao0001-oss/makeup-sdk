package com.wangyihao0001.makeupsdk

import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

data class MakeupSdkConfig(
    val sdkVersion: String = BuildConfig.SDK_VERSION,
    val manifestVersion: Int = 1,
    val modelVersion: Int = 1,
    val rendererVersion: Int = 1,
    val resourceBaseUrl: String? = null,
    val maxFrameWidth: Int = 4096,
    val maxFrameHeight: Int = 4096
)

data class CapabilityReport(
    val platform: String = "android",
    val runtime: String = "native",
    val sdkVersion: String,
    val apiVersion: Int,
    val manifestVersion: Int,
    val modelVersion: Int,
    val rendererVersion: Int,
    val rendererBackend: String,
    val trackerBackend: String,
    val maxFrameWidth: Int,
    val maxFrameHeight: Int,
    val cameraAvailable: Boolean,
    val trackerAvailable: Boolean,
    val rendererAvailable: Boolean,
    val supportsEffects: Map<String, Boolean>,
    val knownLimitations: List<String>
)

data class EffectParams(val category: String, val patternId: Long, val argb: Int, val intensity: Float, val finish: String)
data class ApplyResult(val status: Int, val operationId: Long, val params: EffectParams)
data class ClearResult(val status: Int, val operationId: Long, val category: String? = null)
data class CaptureResult(val path: String?, val timestampNs: Long, val width: Int, val height: Int, val orientation: Int, val mirrored: Boolean, val sdkVersion: String, val manifestVersion: Int, val rendererVersion: Int, val layers: Map<String, EffectParams>)

class SdkError(val status: Int, override val message: String, val details: Any? = null) : Exception(message)
data class SdkEvent(val type: String, val sdkVersion: String, val manifestVersion: Int, val operationId: Long, val category: String?, val status: Int, val timestamp: Long, val state: Int? = null)

class MakeupSdk private constructor(private val config: MakeupSdkConfig) : AutoCloseable {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val native = MakeupSdkJava(config.manifestVersion)
    private var disposed = false
    private val listeners = mutableSetOf<(SdkEvent) -> Unit>()

    companion object {
        suspend fun create(config: MakeupSdkConfig = MakeupSdkConfig()): MakeupSdk = suspendCoroutine { continuation ->
            try { continuation.resume(MakeupSdk(config)) } catch (error: Throwable) { continuation.resumeWithException(error) }
        }
    }

    fun onEvent(listener: (SdkEvent) -> Unit): () -> Unit { listeners += listener; return { listeners -= listener } }
    fun getCapabilities(): CapabilityReport = capabilities()

    suspend fun initialize(): CapabilityReport = run { checkStatus(native.initialize(), "initialize"); checkStatus(native.pump(1), "initialize pump"); capabilities() }
    suspend fun start() { run { checkStatus(native.start(), "start"); checkStatus(native.pump(1), "start pump") } }
    suspend fun apply(params: EffectParams): ApplyResult = run {
        val finish = if (params.finish == "dewy") "glossy" else params.finish
        val operation = nextOperation()
        checkStatus(native.apply(categoryIndex(params.category), finishIndex(finish), params.patternId, params.argb, params.intensity), "apply")
        checkStatus(native.pump(1), "apply pump")
        emit("operationCompleted", operation, params.category, 0)
        ApplyResult(0, operation, params.copy(finish = finish))
    }
    suspend fun clear(category: String): ClearResult = run { checkStatus(native.clear(categoryIndex(category)), "clear"); checkStatus(native.pump(1), "clear pump"); ClearResult(0, nextOperation(), category) }
    suspend fun clearAll(): ClearResult = run { checkStatus(native.clearAll(), "clearAll"); checkStatus(native.pump(1), "clearAll pump"); ClearResult(0, nextOperation()) }
    suspend fun capture(): CaptureResult = run { checkStatus(native.capture(), "capture"); checkStatus(native.pump(1), "capture pump"); CaptureResult(null, 0, 0, 0, 0, false, config.sdkVersion, config.manifestVersion, config.rendererVersion, emptyMap()) }
    suspend fun stop() { run { checkStatus(native.stop(), "stop"); checkStatus(native.pump(1), "stop pump") } }
    suspend fun dispose() { if (!disposed) { disposed = true; run { native.dispose() }; executor.shutdownNow() } }
    override fun close() { if (!disposed) { native.dispose(); native.close(); disposed = true }; executor.shutdownNow() }

    private var operationId = 0L
    private fun nextOperation(): Long = ++operationId
    private suspend fun <T> run(block: () -> T): T = suspendCoroutine { continuation ->
        executor.execute {
            try { continuation.resume(block()) }
            catch (error: Throwable) { continuation.resumeWithException(error) }
        }
    }
    private fun checkStatus(status: Int, action: String) { if (status != 0) throw SdkError(status, "SDK $action failed") }
    private fun capabilities(): CapabilityReport {
        val values = native.capabilities() ?: IntArray(6)
        return CapabilityReport(
            platform = "android",
            runtime = "native",
            sdkVersion = config.sdkVersion,
            apiVersion = values.getOrElse(0) { 2 },
            manifestVersion = values.getOrElse(1) { config.manifestVersion },
            modelVersion = config.modelVersion,
            rendererVersion = config.rendererVersion,
            rendererBackend = "native",
            trackerBackend = "injected",
            maxFrameWidth = config.maxFrameWidth,
            maxFrameHeight = config.maxFrameHeight,
            cameraAvailable = false,
            trackerAvailable = false,
            rendererAvailable = values.getOrElse(4) { 0 } != 0,
            supportsEffects = mapOf("lipstick" to (values.getOrElse(5) { 0 } != 0), "mascara" to false, "eyeliner" to false, "eyeshadow" to false, "blush" to false, "foundation" to false),
            knownLimitations = listOf("Camera, tracker and renderer ports are supplied by the host application.")
        )
    }
    private fun emit(type: String, operation: Long, category: String?, status: Int) { listeners.forEach { it(SdkEvent(type, config.sdkVersion, config.manifestVersion, operation, category, status, System.currentTimeMillis())) } }
    private fun categoryIndex(category: String): Int = listOf("lipstick", "mascara", "eyeliner", "eyeshadow", "blush", "foundation").indexOf(category).also { if (it < 0) throw SdkError(1, "Invalid category") }
    private fun finishIndex(finish: String): Int = listOf("matte", "glossy", "shimmer", "glitter").indexOf(finish).also { if (it < 0) throw SdkError(1, "Invalid finish") }
}
