#include "makeup_sdk/makeup_sdk_v2_runtime.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace {

constexpr uint32_t kApiVersion = 2;

bool valid_category(mk2_effect_category category) {
  return category >= MK2_EFFECT_LIPSTICK && category < MK2_EFFECT_COUNT;
}

bool valid_finish(mk2_finish finish) {
  return finish >= MK2_FINISH_MATTE && finish <= MK2_FINISH_GLITTER;
}

size_t finish_index(mk2_finish finish) {
  return static_cast<size_t>(finish);
}

}  // namespace

namespace mk2 {

mk2_finish normalize_finish(ProductFinish finish) {
  switch (finish) {
    case ProductFinish::Matte:
      return MK2_FINISH_MATTE;
    case ProductFinish::Dewy:
      return MK2_FINISH_GLOSSY;
    case ProductFinish::Shimmer:
      return MK2_FINISH_SHIMMER;
    case ProductFinish::Glitter:
      return MK2_FINISH_GLITTER;
  }
  return MK2_FINISH_MATTE;
}

PatternCatalog::PatternCatalog(uint32_t manifest_version)
    : manifest_version_(manifest_version) {}

mk2_status PatternCatalog::add(CatalogPattern pattern) {
  if (pattern.pattern_id == 0 || !valid_category(pattern.category) ||
      !std::any_of(pattern.supported_finishes.begin(),
                   pattern.supported_finishes.end(),
                   [](bool supported) { return supported; })) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (find(pattern.pattern_id, pattern.category) != nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  patterns_.push_back(std::move(pattern));
  return MK2_STATUS_OK;
}

const CatalogPattern* PatternCatalog::find(
    uint64_t pattern_id, mk2_effect_category category) const {
  const auto iterator = std::find_if(
      patterns_.begin(), patterns_.end(), [pattern_id, category](const auto& p) {
        return p.pattern_id == pattern_id && p.category == category;
      });
  return iterator == patterns_.end() ? nullptr : &*iterator;
}

mk2_status PatternCatalog::validate(const mk2_effect_params& params) const {
  if (!valid_category(params.category) || !valid_finish(params.finish) ||
      !std::isfinite(params.intensity) || params.intensity < 0.0f ||
      params.intensity > 1.0f) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  const CatalogPattern* pattern = find(params.pattern_id, params.category);
  if (pattern == nullptr || !pattern->supported_finishes[finish_index(params.finish)]) {
    return MK2_STATUS_ASSET_LOAD_FAILED;
  }
  return MK2_STATUS_OK;
}

SessionRuntime::SessionRuntime(const RuntimeConfig& config, const PortSet& ports,
                               PatternCatalog catalog)
    : config_(config), ports_(ports), catalog_(std::move(catalog)) {
  mk2_session_create(&config_.core, &session_);
  if (session_ == nullptr) {
    return;
  }
  mk2_capabilities capabilities{};
  capabilities.api_version = kApiVersion;
  capabilities.manifest_version = config_.core.manifest_version;
  capabilities.max_frame_width = config_.max_frame_width;
  capabilities.max_frame_height = config_.max_frame_height;
  mk2_session_bind_capabilities(session_, &capabilities);
}

SessionRuntime::~SessionRuntime() {
  dispose();
}

mk2_status SessionRuntime::initialize() {
  if (session_ == nullptr) {
    return MK2_STATUS_INTERNAL_ERROR;
  }
  if (disposed_) {
    return MK2_STATUS_DISPOSED;
  }
  if (initialized_) {
    return MK2_STATUS_INVALID_STATE;
  }
  if (ports_.camera == nullptr || ports_.tracker == nullptr ||
      ports_.renderer == nullptr || ports_.resources == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }

  mk2_status status = ports_.resources->load_manifest(catalog_.manifest_version());
  if (status != MK2_STATUS_OK) {
    return status;
  }
  status = ports_.tracker->initialize(config_.tracker_version);
  if (status != MK2_STATUS_OK) {
    ports_.resources->release(catalog_.manifest_version());
    return status;
  }
  status = ports_.renderer->initialize(config_.renderer_version);
  if (status != MK2_STATUS_OK) {
    ports_.tracker->dispose();
    ports_.resources->release(catalog_.manifest_version());
    return status;
  }

  mk2_capabilities capabilities{};
  capabilities.api_version = kApiVersion;
  capabilities.manifest_version = catalog_.manifest_version();
  capabilities.renderer_version = config_.renderer_version;
  capabilities.tracker_version = config_.tracker_version;
  capabilities.max_frame_width = config_.max_frame_width;
  capabilities.max_frame_height = config_.max_frame_height;
  capabilities.camera_available = config_.camera_available;
  capabilities.tracker_available = config_.tracker_available;
  capabilities.renderer_available = config_.renderer_available;
  capabilities.supports_effects[MK2_EFFECT_LIPSTICK] =
      (capabilities.camera_available != 0 &&
       capabilities.tracker_available != 0 &&
       capabilities.renderer_available != 0)
          ? 1
          : 0;
  status = mk2_session_bind_capabilities(session_, &capabilities);
  if (status != MK2_STATUS_OK) {
    ports_.renderer->dispose();
    ports_.tracker->dispose();
    ports_.resources->release(catalog_.manifest_version());
    return status;
  }

  uint64_t operation_id = 0;
  status = mk2_session_initialize(session_, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status != MK2_STATUS_OK) {
    ports_.renderer->dispose();
    ports_.tracker->dispose();
    ports_.resources->release(catalog_.manifest_version());
    return status;
  }
  initialized_ = true;
  return refresh_layers();
}

mk2_status SessionRuntime::start() {
  if (!initialized_ || disposed_) {
    return disposed_ ? MK2_STATUS_DISPOSED : MK2_STATUS_NOT_INITIALIZED;
  }
  if (started_) {
    return MK2_STATUS_INVALID_STATE;
  }
  mk2_status status = ports_.tracker->reset();
  if (status != MK2_STATUS_OK) {
    return status;
  }
  uint64_t operation_id = 0;
  status = mk2_session_start(session_, &operation_id);
  if (status != MK2_STATUS_OK) {
    return status;
  }
  status = pump(1);
  if (status != MK2_STATUS_OK) {
    return status;
  }
  started_ = true;
  status = ports_.camera->start([this](const mk2_frame& frame) { on_frame(frame); });
  if (status != MK2_STATUS_OK) {
    started_ = false;
    mk2_session_stop(session_, &operation_id);
    pump(1);
    return status;
  }
  return MK2_STATUS_OK;
}

mk2_status SessionRuntime::stop() {
  if (disposed_) {
    return MK2_STATUS_DISPOSED;
  }
  if (!initialized_ || !started_) {
    return MK2_STATUS_INVALID_STATE;
  }
  mk2_status status = ports_.camera->stop();
  if (status != MK2_STATUS_OK) {
    return status;
  }
  status = ports_.tracker->reset();
  if (status != MK2_STATUS_OK) {
    return status;
  }
  uint64_t operation_id = 0;
  status = mk2_session_stop(session_, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status == MK2_STATUS_OK) {
    started_ = false;
  }
  return status;
}

mk2_status SessionRuntime::apply(mk2_effect_params params,
                                 ProductFinish product_finish) {
  if (!initialized_ || disposed_) {
    return disposed_ ? MK2_STATUS_DISPOSED : MK2_STATUS_NOT_INITIALIZED;
  }
  params.finish = normalize_finish(product_finish);
  mk2_status status = catalog_.validate(params);
  if (status != MK2_STATUS_OK) {
    return status;
  }
  status = ports_.resources->load_pattern(params.pattern_id,
                                          catalog_.manifest_version());
  if (status != MK2_STATUS_OK) {
    return status;
  }
  uint64_t operation_id = 0;
  status = mk2_session_apply(session_, &params, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status == MK2_STATUS_OK) {
    status = refresh_layers();
  }
  return status;
}

mk2_status SessionRuntime::clear(mk2_effect_category category) {
  if (!initialized_ || disposed_) {
    return disposed_ ? MK2_STATUS_DISPOSED : MK2_STATUS_NOT_INITIALIZED;
  }
  uint64_t operation_id = 0;
  mk2_status status = mk2_session_clear(session_, category, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status == MK2_STATUS_OK) {
    status = refresh_layers();
  }
  return status;
}

mk2_status SessionRuntime::clear_all() {
  if (!initialized_ || disposed_) {
    return disposed_ ? MK2_STATUS_DISPOSED : MK2_STATUS_NOT_INITIALIZED;
  }
  uint64_t operation_id = 0;
  mk2_status status = mk2_session_clear_all(session_, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status == MK2_STATUS_OK) {
    status = refresh_layers();
  }
  return status;
}

mk2_status SessionRuntime::capture(RuntimeCapture* out_capture) {
  if (out_capture == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!initialized_ || disposed_) {
    return disposed_ ? MK2_STATUS_DISPOSED : MK2_STATUS_NOT_INITIALIZED;
  }
  if (!started_) {
    return MK2_STATUS_INVALID_STATE;
  }
  mk2_capture_metadata metadata{};
  mk2_status status = ports_.renderer->capture(&metadata);
  if (status != MK2_STATUS_OK) {
    return status;
  }
  uint64_t operation_id = 0;
  status = mk2_session_capture(session_, &operation_id);
  if (status == MK2_STATUS_OK) {
    status = pump(1);
  }
  if (status != MK2_STATUS_OK) {
    return status;
  }
  metadata.api_version = kApiVersion;
  metadata.manifest_version = catalog_.manifest_version();
  metadata.renderer_version = config_.renderer_version;
  out_capture->metadata = metadata;
  out_capture->layers = layers_;
  return MK2_STATUS_OK;
}

mk2_status SessionRuntime::pump(uint32_t max_operations) {
  if (session_ == nullptr) {
    return MK2_STATUS_INTERNAL_ERROR;
  }
  return mk2_session_pump(session_, max_operations);
}

mk2_status SessionRuntime::poll_event(mk2_event* out_event) {
  if (session_ == nullptr) {
    return MK2_STATUS_INTERNAL_ERROR;
  }
  return mk2_session_poll_event(session_, out_event);
}

mk2_status SessionRuntime::dispose() {
  if (session_ == nullptr) {
    return MK2_STATUS_INTERNAL_ERROR;
  }
  if (disposed_) {
    return MK2_STATUS_OK;
  }
  if (started_) {
    ports_.camera->stop();
    started_ = false;
  }
  if (initialized_) {
    ports_.renderer->dispose();
    ports_.tracker->dispose();
    ports_.resources->release(catalog_.manifest_version());
  }
  const mk2_status status = mk2_session_dispose(session_);
  disposed_ = true;
  initialized_ = false;
  return status;
}

mk2_state SessionRuntime::state() const {
  mk2_state current = MK2_STATE_ERROR;
  if (session_ != nullptr &&
      mk2_session_get_state(session_, &current) == MK2_STATUS_OK) {
    return current;
  }
  return current;
}

mk2_capabilities SessionRuntime::capabilities() const {
  mk2_capabilities capabilities{};
  if (session_ != nullptr) {
    mk2_session_get_capabilities(session_, &capabilities);
  }
  return capabilities;
}

void SessionRuntime::on_frame(const mk2_frame& frame) {
  if (!started_ || disposed_) {
    return;
  }
  mk2_tracking_result tracking{};
  if (ports_.tracker->estimate(frame, &tracking) != MK2_STATUS_OK) {
    return;
  }
  if (mk2_session_submit_frame(session_, &frame, &tracking) != MK2_STATUS_OK) {
    return;
  }
  if (refresh_layers() != MK2_STATUS_OK) {
    return;
  }
  ports_.renderer->render(frame, tracking, layers_.data(), layers_.size());
}

mk2_status SessionRuntime::refresh_layers() {
  for (size_t index = 0; index < layers_.size(); ++index) {
    const auto category = static_cast<mk2_effect_category>(index);
    const mk2_status status =
        mk2_session_get_layer(session_, category, &layers_[index]);
    if (status != MK2_STATUS_OK) {
      return status;
    }
  }
  return MK2_STATUS_OK;
}

}  // namespace mk2
