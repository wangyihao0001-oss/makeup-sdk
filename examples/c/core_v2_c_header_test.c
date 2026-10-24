#include "makeup_sdk/makeup_sdk_v2.h"

int main(void) {
  mk2_config config = {2, 1};
  mk2_effect_params params = {
      MK2_EFFECT_LIPSTICK, MK2_FINISH_MATTE, 1, 0, 0.5f};
  return (config.api_version == 2 && params.category == MK2_EFFECT_LIPSTICK)
             ? 0
             : 1;
}
