#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString * const MakeupSDKVersion;

/** Minimal Objective-C facade over the shared C ABI. */
@interface MakeupSDK : NSObject {
  void *_session;
}

- (instancetype)initWithManifestVersion:(uint32_t)manifestVersion;
- (int)initialize;
- (int)pump:(uint32_t)maxOperations;
- (int)start;
- (int)stop;
- (int)state;
- (nullable NSArray<NSNumber *> *)capabilities;
- (int)dispose;

@end

NS_ASSUME_NONNULL_END
