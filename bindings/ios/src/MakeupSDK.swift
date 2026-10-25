import Foundation

public struct MakeupSDKConfiguration {
    public var sdkVersion: String
    public var manifestVersion: UInt32
    public var modelVersion: UInt32
    public var rendererVersion: UInt32
    public var resourceBaseURL: URL?

    public init(sdkVersion: String = "0.1.0", manifestVersion: UInt32 = 1,
                modelVersion: UInt32 = 1, rendererVersion: UInt32 = 1,
                resourceBaseURL: URL? = nil) {
        self.sdkVersion = sdkVersion
        self.manifestVersion = manifestVersion
        self.modelVersion = modelVersion
        self.rendererVersion = rendererVersion
        self.resourceBaseURL = resourceBaseURL
    }
}

public struct CapabilityReport {
    public let platform: String
    public let runtime: String
    public let sdkVersion: String
    public let apiVersion: UInt32
    public let manifestVersion: UInt32
    public let modelVersion: UInt32
    public let rendererVersion: UInt32
    public let rendererBackend: String
    public let trackerBackend: String
    public let maxFrameWidth: UInt32
    public let maxFrameHeight: UInt32
    public let cameraAvailable: Bool
    public let trackerAvailable: Bool
    public let rendererAvailable: Bool
    public let supportsEffects: [String: Bool]
    public let knownLimitations: [String]
}

public struct EffectParameters {
    public let category: String
    public let patternId: UInt64
    public let argb: UInt32
    public let intensity: Float
    public let finish: String
}

public struct CaptureResult {
    public let path: String?
    public let timestampNs: UInt64
    public let width: UInt32
    public let height: UInt32
    public let orientation: UInt32
    public let mirrored: Bool
    public let sdkVersion: String
    public let manifestVersion: UInt32
    public let rendererVersion: UInt32
    public let layers: [String: EffectParameters]
}

public enum SDKError: Error {
    case status(Int32, String)
}

public struct SDKEvent {
    public let type: String
    public let sdkVersion: String
    public let manifestVersion: UInt32
    public let operationId: UInt64
    public let category: String?
    public let status: Int32
    public let timestamp: Date
}

public final class MakeupSDK {
    private let configuration: MakeupSDKConfiguration
    private let native: MakeupSDKObjC
    private var listeners: [(SDKEvent) -> Void] = []

    private init(configuration: MakeupSDKConfiguration, native: MakeupSDKObjC) {
        self.configuration = configuration
        self.native = native
    }

    public static func create(_ configuration: MakeupSDKConfiguration = .init()) async throws -> MakeupSDK {
        guard let native = MakeupSDKObjC(manifestVersion: configuration.manifestVersion) else {
            throw SDKError.status(11, "Unable to create MakeupSDK")
        }
        return MakeupSDK(configuration: configuration, native: native)
    }

    public func getCapabilities() -> CapabilityReport { capabilities() }
    public func onEvent(_ listener: @escaping (SDKEvent) -> Void) -> () -> Void {
        listeners.append(listener)
        return { }
    }

    public func initialize() async throws -> CapabilityReport {
        try check(native.initialize(), action: "initialize")
        try check(native.pump(1), action: "initialize pump")
        return capabilities()
    }

    public func start() async throws {
        try check(native.start(), action: "start")
        try check(native.pump(1), action: "start pump")
    }

    public func apply(_ parameters: EffectParameters) async throws {
        throw SDKError.status(14, "Native renderer ports are not connected")
    }

    public func clear(_ category: String) async throws { throw SDKError.status(14, "Native renderer ports are not connected") }
    public func clearAll() async throws { throw SDKError.status(14, "Native renderer ports are not connected") }

    public func capture() async throws -> CaptureResult {
        try check(native.capture(), action: "capture")
        try check(native.pump(1), action: "capture pump")
        return CaptureResult(path: nil, timestampNs: 0, width: 0, height: 0,
                             orientation: 0, mirrored: false,
                             sdkVersion: configuration.sdkVersion,
                             manifestVersion: configuration.manifestVersion,
                             rendererVersion: configuration.rendererVersion,
                             layers: [:])
    }

    public func stop() async throws {
        try check(native.stop(), action: "stop")
        try check(native.pump(1), action: "stop pump")
    }

    public func dispose() async { _ = native.dispose() }

    private func check(_ status: Int32, action: String) throws {
        if status != 0 { throw SDKError.status(status, "SDK \(action) failed") }
    }

    private func capabilities() -> CapabilityReport {
        let values = native.capabilities() ?? []
        let api = UInt32(values[safe: 0] ?? 2)
        let manifest = UInt32(values[safe: 1] ?? Int(configuration.manifestVersion))
        let maxWidth = UInt32(values[safe: 2] ?? 4096)
        let maxHeight = UInt32(values[safe: 3] ?? 4096)
        let renderer = (values[safe: 4] ?? 0) != 0
        let lipstick = (values[safe: 5] ?? 0) != 0
        return CapabilityReport(platform: "ios", runtime: "native", sdkVersion: configuration.sdkVersion,
                                apiVersion: api, manifestVersion: manifest,
                                modelVersion: configuration.modelVersion,
                                rendererVersion: configuration.rendererVersion,
                                rendererBackend: "unavailable", trackerBackend: "unavailable",
                                maxFrameWidth: maxWidth, maxFrameHeight: maxHeight,
                                cameraAvailable: false, trackerAvailable: false,
                                rendererAvailable: renderer,
                                supportsEffects: ["lipstick": lipstick, "mascara": false, "eyeliner": false, "eyeshadow": false, "blush": false, "foundation": false],
                                knownLimitations: ["Camera, tracker and renderer ports are supplied by the host application."])
    }
}

private extension Array {
    subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}
