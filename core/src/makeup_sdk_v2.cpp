#include "makeup_sdk/makeup_sdk_v2.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <deque>
#include <limits>
#include <new>

namespace {

constexpr uint32_t kApiVersion = 2;
constexpr uint32_t kDefaultManifestVersion = 1;
constexpr uint32_t kMaxFrameWidth = 4096;
constexpr uint32_t kMaxFrameHeight = 4096;
constexpr uint32_t kSupportedMirroredValues = 1;

enum class OperationType {
  Initialize,
  Start,
  Stop,
  Apply,
  Clear,
  ClearAll,
  Capture,
};

struct Operation {
  OperationType type;
  uint64_t id;
  uint64_t mutation_generation = 0;
  uint64_t mutation_epoch = 0;
  mk2_effect_params params{};
  mk2_effect_category category = MK2_EFFECT_LIPSTICK;
};

bool valid_category(mk2_effect_category category) {
  return category >= MK2_EFFECT_LIPSTICK && category < MK2_EFFECT_COUNT;
}

bool valid_finish(mk2_finish finish) {
  return finish >= MK2_FINISH_MATTE && finish <= MK2_FINISH_GLITTER;
}

bool valid_orientation(uint32_t degrees) {
  return degrees == 0 || degrees == 90 || degrees == 180 || degrees == 270;
}

bool valid_mirrored(uint8_t mirrored) {
  return mirrored <= kSupportedMirroredValues;
}

bool valid_effect(const mk2_effect_params& params) {
  return valid_category(params.category) && valid_finish(params.finish) &&
         params.intensity >= 0.0f && params.intensity <= 1.0f;
}

size_t category_index(mk2_effect_category category) {
  return static_cast<size_t>(category);
}

}  // namespace

struct mk2_session {
  uint32_t manifest_version = kDefaultManifestVersion;
  mk2_state state = MK2_STATE_IDLE;
  uint64_t next_operation_id = 1;
  std::array<bool, MK2_EFFECT_COUNT> has_layer{};
  std::array<mk2_effect_params, MK2_EFFECT_COUNT> layers{};
  std::deque<Operation> operations;
  std::deque<mk2_event> events;
  std::array<uint64_t, MK2_EFFECT_COUNT> mutation_generations{};
  uint64_t mutation_epoch = 1;
  bool has_valid_frame = false;
  uint64_t last_frame_timestamp_ns = 0;
  bool disposed = false;
  mk2_capabilities capabilities{};
};

namespace {

mk2_status ensure_session(const mk2_session* session) {
  if (session == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  return session->disposed ? MK2_STATUS_DISPOSED : MK2_STATUS_OK;
}

mk2_status ensure_not_disposed(const mk2_session* session) {
  return ensure_session(session);
}

uint64_t allocate_operation(mk2_session* session) {
  return session->next_operation_id++;
}

void emit_event(mk2_session* session, mk2_event_type type, mk2_state state,
                mk2_status status, uint64_t operation_id,
                mk2_effect_category category = MK2_EFFECT_LIPSTICK) {
  session->events.push_back(
      {type, state, status, operation_id, category});
}

void change_state(mk2_session* session, mk2_state state, uint64_t operation_id,
                  mk2_status status = MK2_STATUS_OK) {
  session->state = state;
  emit_event(session, MK2_EVENT_STATE_CHANGED, state, status, operation_id);
}

mk2_status enqueue(mk2_session* session, Operation operation,
                   uint64_t* out_operation_id) {
  if (out_operation_id == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  *out_operation_id = operation.id;
  session->operations.push_back(operation);
  return MK2_STATUS_OK;
}

uint64_t category_generation(const mk2_session* session,
                             mk2_effect_category category) {
  return session->mutation_generations[category_index(category)];
}

mk2_effect_category operation_category(const Operation& operation) {
  if (operation.type == OperationType::Apply) {
    return operation.params.category;
  }
  return operation.category;
}

bool mutation_token_is_current(const mk2_session* session,
                               const Operation& operation) {
  if (operation.mutation_epoch != session->mutation_epoch) {
    return false;
  }
  if (operation.type == OperationType::ClearAll) {
    return true;
  }
  if (operation.type != OperationType::Apply &&
      operation.type != OperationType::Clear) {
    return true;
  }
  return operation.mutation_generation ==
         category_generation(session, operation_category(operation));
}

bool start_allowed(mk2_state state) {
  return state == MK2_STATE_READY || state == MK2_STATE_CAPTURED;
}

bool stop_allowed(mk2_state state) {
  return state == MK2_STATE_TRACKING || state == MK2_STATE_RENDERING ||
         state == MK2_STATE_CAPTURED;
}

bool mutation_allowed(mk2_state state) {
  return state == MK2_STATE_READY || state == MK2_STATE_TRACKING ||
         state == MK2_STATE_RENDERING || state == MK2_STATE_CAPTURED;
}

bool is_mutation(const Operation& operation) {
  return operation.type == OperationType::Apply ||
         operation.type == OperationType::Clear ||
         operation.type == OperationType::ClearAll;
}

bool affects_category(const Operation& operation, mk2_effect_category category) {
  if (operation.type == OperationType::Apply) {
    return operation.params.category == category;
  }
  if (operation.type == OperationType::Clear) {
    return operation.category == category;
  }
  return false;
}

void cancel_pending_mutations(mk2_session* session, bool all_categories,
                              mk2_effect_category category) {
  for (auto iterator = session->operations.begin();
       iterator != session->operations.end();) {
    if (is_mutation(*iterator) &&
        (all_categories || affects_category(*iterator, category))) {
      const Operation cancelled = *iterator;
      iterator = session->operations.erase(iterator);
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OPERATION_CANCELLED, cancelled.id,
                 operation_category(cancelled));
    } else {
      ++iterator;
    }
  }
}

mk2_status reject_frame(mk2_session* session, mk2_status status) {
  session->has_valid_frame = false;
  emit_event(session, MK2_EVENT_FRAME_REJECTED, session->state, status, 0);
  return status;
}

bool required_rgba_size(uint32_t width, uint32_t height, size_t* out_size) {
  const uint64_t pixels = static_cast<uint64_t>(width) * height;
  const uint64_t bytes = pixels * 4;
  if (bytes > std::numeric_limits<size_t>::max()) {
    return false;
  }
  *out_size = static_cast<size_t>(bytes);
  return true;
}

mk2_status process_operation(mk2_session* session, const Operation& operation) {
  switch (operation.type) {
    case OperationType::Initialize:
      if (session->state != MK2_STATE_LOADING) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      change_state(session, MK2_STATE_READY, operation.id);
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id);
      return MK2_STATUS_OK;

    case OperationType::Start:
      if (!start_allowed(session->state)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      session->has_valid_frame = false;
      change_state(session, MK2_STATE_TRACKING, operation.id);
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id);
      return MK2_STATUS_OK;

    case OperationType::Stop:
      if (!stop_allowed(session->state)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      session->has_valid_frame = false;
      change_state(session, MK2_STATE_READY, operation.id);
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id);
      return MK2_STATUS_OK;

    case OperationType::Apply: {
      if (!mutation_token_is_current(session, operation)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id,
                   operation.params.category);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      if (session->capabilities.supports_effects[
              category_index(operation.params.category)] == 0) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_UNSUPPORTED_EFFECT, operation.id,
                   operation.params.category);
        return MK2_STATUS_UNSUPPORTED_EFFECT;
      }
      if (!mutation_allowed(session->state) ||
          !valid_effect(operation.params)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id,
                   operation.params.category);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      const size_t index = category_index(operation.params.category);
      session->layers[index] = operation.params;
      session->has_layer[index] = true;
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id, operation.params.category);
      return MK2_STATUS_OK;
    }

    case OperationType::Clear:
      if (!mutation_token_is_current(session, operation)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id,
                   operation.category);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      if (!mutation_allowed(session->state) ||
          !valid_category(operation.category)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id,
                   operation.category);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      session->has_layer[category_index(operation.category)] = false;
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id, operation.category);
      return MK2_STATUS_OK;

    case OperationType::ClearAll:
      if (!mutation_token_is_current(session, operation)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      if (!mutation_allowed(session->state)) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_OPERATION_CANCELLED, operation.id);
        return MK2_STATUS_OPERATION_CANCELLED;
      }
      session->has_layer.fill(false);
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id);
      return MK2_STATUS_OK;

    case OperationType::Capture:
      if (!session->has_valid_frame) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_NO_FRAME, operation.id);
        return MK2_STATUS_NO_FRAME;
      }
      if (session->capabilities.renderer_available == 0) {
        emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                   MK2_STATUS_RENDERER_UNAVAILABLE, operation.id);
        return MK2_STATUS_RENDERER_UNAVAILABLE;
      }
      session->state = MK2_STATE_CAPTURED;
      emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
                 MK2_STATUS_OK, operation.id);
      return MK2_STATUS_OK;
  }

  return MK2_STATUS_INTERNAL_ERROR;
}

}  // namespace

extern "C" mk2_status mk2_session_create(const mk2_config* config,
                                           mk2_session** out_session) {
  if (out_session == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (config != nullptr && config->api_version != 0 &&
      config->api_version != kApiVersion) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }

  auto* session = new (std::nothrow) mk2_session();
  if (session == nullptr) {
    return MK2_STATUS_INTERNAL_ERROR;
  }
  if (config != nullptr && config->manifest_version != 0) {
    session->manifest_version = config->manifest_version;
  }
  session->capabilities = {};
  session->capabilities.api_version = kApiVersion;
  session->capabilities.manifest_version = session->manifest_version;
  session->capabilities.max_frame_width = kMaxFrameWidth;
  session->capabilities.max_frame_height = kMaxFrameHeight;
  *out_session = session;
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_initialize(mk2_session* session,
                                                uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (session->state != MK2_STATE_IDLE) {
    return MK2_STATUS_INVALID_STATE;
  }
  const uint64_t operation_id = allocate_operation(session);
  change_state(session, MK2_STATE_LOADING, operation_id);
  return enqueue(session, {OperationType::Initialize, operation_id},
                 out_operation_id);
}

extern "C" mk2_status mk2_session_start(mk2_session* session,
                                          uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!start_allowed(session->state)) {
    return MK2_STATUS_INVALID_STATE;
  }
  const uint64_t operation_id = allocate_operation(session);
  return enqueue(session, {OperationType::Start, operation_id},
                 out_operation_id);
}

extern "C" mk2_status mk2_session_stop(mk2_session* session,
                                         uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!stop_allowed(session->state)) {
    return MK2_STATUS_INVALID_STATE;
  }
  const uint64_t operation_id = allocate_operation(session);
  return enqueue(session, {OperationType::Stop, operation_id},
                 out_operation_id);
}

extern "C" mk2_status mk2_session_dispose(mk2_session* session) {
  if (session == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (session->disposed) {
    return MK2_STATUS_OK;
  }
  while (!session->operations.empty()) {
    const Operation operation = session->operations.front();
    session->operations.pop_front();
    emit_event(session, MK2_EVENT_OPERATION_COMPLETED, session->state,
               MK2_STATUS_OPERATION_CANCELLED, operation.id,
               operation_category(operation));
  }
  ++session->mutation_epoch;
  session->has_valid_frame = false;
  session->disposed = true;
  session->state = MK2_STATE_DISPOSED;
  emit_event(session, MK2_EVENT_STATE_CHANGED, session->state, MK2_STATUS_OK,
             0);
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_destroy(mk2_session* session) {
  if (session == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!session->disposed) {
    mk2_session_dispose(session);
  }
  delete session;
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_get_state(const mk2_session* session,
                                              mk2_state* out_state) {
  if (session == nullptr || out_state == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  *out_state = session->state;
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_get_capabilities(
    const mk2_session* session, mk2_capabilities* out_capabilities) {
  const mk2_status status = ensure_session(session);
  if (status != MK2_STATUS_OK || out_capabilities == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  *out_capabilities = session->capabilities;
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_apply(mk2_session* session,
                                          const mk2_effect_params* params,
                                          uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || params == nullptr ||
      out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!valid_effect(*params)) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!mutation_allowed(session->state)) {
    return MK2_STATUS_INVALID_STATE;
  }
  if (session->capabilities.supports_effects[category_index(params->category)] ==
      0) {
    return MK2_STATUS_UNSUPPORTED_EFFECT;
  }
  cancel_pending_mutations(session, false, params->category);
  const uint64_t operation_id = allocate_operation(session);
  Operation operation{OperationType::Apply, operation_id};
  operation.params = *params;
  ++session->mutation_generations[category_index(params->category)];
  operation.mutation_generation =
      category_generation(session, params->category);
  operation.mutation_epoch = session->mutation_epoch;
  return enqueue(session, operation, out_operation_id);
}

extern "C" mk2_status mk2_session_clear(mk2_session* session,
                                          mk2_effect_category category,
                                          uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!valid_category(category)) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!mutation_allowed(session->state)) {
    return MK2_STATUS_INVALID_STATE;
  }
  cancel_pending_mutations(session, false, category);
  const uint64_t operation_id = allocate_operation(session);
  Operation operation{OperationType::Clear, operation_id};
  operation.category = category;
  ++session->mutation_generations[category_index(category)];
  operation.mutation_generation = category_generation(session, category);
  operation.mutation_epoch = session->mutation_epoch;
  return enqueue(session, operation, out_operation_id);
}

extern "C" mk2_status mk2_session_clear_all(mk2_session* session,
                                              uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!mutation_allowed(session->state)) {
    return MK2_STATUS_INVALID_STATE;
  }
  cancel_pending_mutations(session, true, MK2_EFFECT_LIPSTICK);
  ++session->mutation_epoch;
  const uint64_t operation_id = allocate_operation(session);
  Operation operation{OperationType::ClearAll, operation_id};
  operation.mutation_epoch = session->mutation_epoch;
  return enqueue(session, operation, out_operation_id);
}

extern "C" mk2_status mk2_session_submit_frame(
    mk2_session* session, const mk2_frame* frame,
    const mk2_tracking_result* tracking) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || frame == nullptr || tracking == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (session->state != MK2_STATE_TRACKING &&
      session->state != MK2_STATE_RENDERING) {
    return MK2_STATUS_INVALID_STATE;
  }
  if (frame->width == 0 || frame->height == 0 || frame->data == nullptr ||
      !valid_orientation(frame->orientation_degrees) ||
      !valid_mirrored(frame->mirrored) ||
      frame->width > session->capabilities.max_frame_width ||
      frame->height > session->capabilities.max_frame_height ||
      (frame->pixel_format != MK2_PIXEL_FORMAT_RGBA8 &&
       frame->pixel_format != MK2_PIXEL_FORMAT_BGRA8)) {
    return reject_frame(session, MK2_STATUS_FRAME_INVALID);
  }
  size_t required_size = 0;
  if (!required_rgba_size(frame->width, frame->height, &required_size) ||
      frame->data_size != required_size) {
    return reject_frame(session, MK2_STATUS_FRAME_INVALID);
  }
  if (!std::isfinite(tracking->confidence) || tracking->confidence < 0.0f ||
      tracking->confidence > 1.0f) {
    return reject_frame(session, MK2_STATUS_FRAME_INVALID);
  }
  if (tracking->face_count == 0) {
    return reject_frame(session, MK2_STATUS_NO_FACE);
  }
  if (tracking->face_count > 1) {
    return reject_frame(session, MK2_STATUS_MULTIPLE_FACES);
  }
  if (tracking->timestamp_ns != frame->timestamp_ns) {
    return reject_frame(session, MK2_STATUS_FRAME_INVALID);
  }
  session->last_frame_timestamp_ns = frame->timestamp_ns;
  session->has_valid_frame = true;
  session->state = MK2_STATE_RENDERING;
  emit_event(session, MK2_EVENT_STATE_CHANGED, session->state, MK2_STATUS_OK,
             0);
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_capture(mk2_session* session,
                                            uint64_t* out_operation_id) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK || out_operation_id == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!session->has_valid_frame) {
    return MK2_STATUS_NO_FRAME;
  }
  if (session->state != MK2_STATE_RENDERING) {
    return MK2_STATUS_INVALID_STATE;
  }
  const uint64_t operation_id = allocate_operation(session);
  return enqueue(session, {OperationType::Capture, operation_id},
                 out_operation_id);
}

extern "C" mk2_status mk2_session_pump(mk2_session* session,
                                         uint32_t max_operations) {
  const mk2_status status = ensure_not_disposed(session);
  if (status != MK2_STATUS_OK) {
    return status;
  }
  if (max_operations == 0) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  uint32_t processed = 0;
  while (!session->operations.empty() && processed < max_operations) {
    const Operation operation = session->operations.front();
    session->operations.pop_front();
    process_operation(session, operation);
    ++processed;
  }
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_poll_event(mk2_session* session,
                                               mk2_event* out_event) {
  if (session == nullptr || out_event == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (session->events.empty()) {
    return MK2_STATUS_NO_EVENT;
  }
  *out_event = session->events.front();
  session->events.pop_front();
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_get_layer(
    const mk2_session* session, mk2_effect_category category,
    mk2_layer_snapshot* out_layer) {
  const mk2_status status = ensure_session(session);
  if (status != MK2_STATUS_OK || out_layer == nullptr) {
    return status != MK2_STATUS_OK ? status : MK2_STATUS_INVALID_ARGUMENT;
  }
  if (!valid_category(category)) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  const size_t index = category_index(category);
  out_layer->active = session->has_layer[index] ? 1 : 0;
  out_layer->params = session->layers[index];
  return MK2_STATUS_OK;
}

extern "C" mk2_status mk2_session_bind_capabilities(
    mk2_session* session, const mk2_capabilities* capabilities) {
  if (session == nullptr || capabilities == nullptr) {
    return MK2_STATUS_INVALID_ARGUMENT;
  }
  if (session->disposed || capabilities->api_version != kApiVersion ||
      capabilities->manifest_version != session->manifest_version) {
    return session->disposed ? MK2_STATUS_DISPOSED : MK2_STATUS_INVALID_ARGUMENT;
  }
  session->capabilities = *capabilities;
  session->capabilities.max_frame_width =
      capabilities->max_frame_width == 0 ? kMaxFrameWidth
                                          : capabilities->max_frame_width;
  session->capabilities.max_frame_height =
      capabilities->max_frame_height == 0 ? kMaxFrameHeight
                                           : capabilities->max_frame_height;
  return MK2_STATUS_OK;
}
