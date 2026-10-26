# Makeup SDK

## Current v2 contract slice

The repository currently freezes the v2 C data contract in
`core/include/makeup_sdk/makeup_sdk_v2.h`: lifecycle states, effect categories and
finishes, frame/tracking validation, capability flags, capture metadata, and
stable status/event values. New status and event values are appended so existing
numeric values remain compatible.

The platform-neutral port boundary is a C++ internal contract in
`core/include/makeup_sdk/makeup_sdk_v2_ports.h`. `CameraPort`, `TrackerPort`,
`RendererPort`, and `ResourcePort` receive platform objects through abstract
methods; no camera, UI, GPU, or platform handle is stored by the shared C ABI.
The port contract is verified by deterministic fake implementations in
`examples/cpp/v2_fake_ports_test.cpp`. Image-buffer ownership is intentionally
left to a future renderer binding; `mk2_capture_metadata` freezes only metadata
needed across bindings.

## Requirement: Shared cross-platform runtime

The SDK SHALL expose a platform-neutral core for the mini-program binding. Shared modules SHALL NOT access `window`, `document`, `HTMLVideoElement`, `HTMLCanvasElement`, or Three.js globals.

The SDK SHALL receive camera frames, face landmarks, render targets and asset loading through injected ports. The mini-program adapter MAY use WeChat camera APIs, WebGL and platform GPU APIs, but those APIs MUST remain outside the shared core.

The SDK SHALL publish lifecycle, parameter, error and capture semantics through the TypeScript/JavaScript mini-program binding.

#### Scenario: Platform binding loads without foreign runtime globals

- **WHEN** a mini-program client loads its binding
- **THEN** module evaluation completes without reading another platform's runtime globals
- **AND** the binding reports adapter readiness separately from business page readiness.

## Requirement: Async lifecycle and rendering

The SDK SHALL provide asynchronous initialization, effect application, frame capture and disposal. A later operation SHALL invalidate an earlier pending operation when they target the same session.

The SDK SHALL expose explicit states for `idle`, `loading`, `ready`, `tracking`, `rendering`, `captured`, `unsupported` and `error`.

#### Scenario: Rapid color changes

- **WHEN** a user selects color A and immediately selects color B
- **THEN** the frame that can be captured SHALL use color B
- **AND** a late completion for color A SHALL NOT overwrite the active parameters or rendered layer.

#### Scenario: Dispose during pending load

- **WHEN** the page leaves while assets or tracking are pending
- **THEN** the SDK stops frame delivery, releases the renderer and tracker, and ignores late callbacks.

## Requirement: Makeup catalog compatibility

The SDK SHALL expose stable pattern IDs and a manifest version rather than relying on array indexes. The product facade SHALL support lipstick, mascara, eyeline, eyeshadow, blush and foundation.

The adapter SHALL map the product finish `dewy` to the engine finish `glossy`, preserve `matte`, `shimmer` and `glitter`, and return the normalized value in captured parameters.

#### Scenario: Versioned catalog

- **WHEN** a saved result records a pattern ID and manifest version
- **THEN** the same values are available to the capture and save payload
- **AND** a missing future asset produces an explicit unavailable state instead of silently selecting another pattern.

## Requirement: Real frame pipeline in the mini-program host

The first production-capable milestone SHALL prove one lipstick effect on one supported WeChat mini-program device: camera frame acquisition, face landmark tracking, WebGL compositing, current-frame capture and resource release.

The pipeline SHALL keep live frames on the device. Only an explicit save action MAY upload the captured image through the existing private asset flow.

#### Scenario: Face unavailable in the mini-program host

- **WHEN** the tracker reports no face, multiple faces or an unusable frame
- **THEN** the renderer keeps the previous valid state or pauses rendering with a user-visible reason
- **AND** capture does not claim a valid lipstick result.

## Requirement: Platform capability matrix

The SDK SHALL expose a capability report containing platform, SDK version, renderer backend, tracker backend, maximum supported frame size, supported effect categories, model/catalog versions and known limitations.

The SDK SHALL use explicit capability and error codes for camera permission, unsupported tracker, GPU context loss, model load failure, asset load failure, no face, multiple faces and capture failure. A platform MAY support fewer categories during staged rollout, but the binding MUST report the limitation before the user starts a session.

#### Scenario: Partial platform support

- **WHEN** a platform can render lipstick but not foundation
- **THEN** capability reporting marks lipstick as supported and foundation as unsupported
- **AND** applying foundation returns a stable unsupported-effect error without changing the lipstick layer.

## Requirement: Unified coordinate and pixel contract

The SDK SHALL define one normalized face-coordinate system, camera orientation/mirroring rules, color space, alpha convention and output image orientation for all bindings.

Each platform adapter SHALL convert its native camera buffer into that contract before tracking or rendering and SHALL report conversion failures explicitly.

#### Scenario: Front-camera mirror

- **WHEN** the mini-program uses its front camera
- **THEN** the same landmark and effect coordinates produce the same logical left/right result
- **AND** the captured image declares its final orientation and mirror state.

## Requirement: Testable adapters

The repository SHALL include deterministic fake ports for unit tests and a device probe for the WeChat camera, tracker and WebGL adapters. The fake ports SHALL never be presented as AR acceptance evidence.

#### Scenario: Adapter failure

- **WHEN** a platform adapter cannot initialize or loses its context
- **THEN** the SDK enters `unsupported` or `error` with a recoverable message
- **AND** it does not fall back to cloud rendering or upload live frames.

