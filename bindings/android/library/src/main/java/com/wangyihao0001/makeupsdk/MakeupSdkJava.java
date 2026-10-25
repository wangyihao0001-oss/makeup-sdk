package com.wangyihao0001.makeupsdk;

/** Java callback-compatible compatibility facade over the shared C ABI. */
@Deprecated
public final class MakeupSdkJava implements AutoCloseable {
    public static final int STATUS_OK = 0;
    private long handle;

    static { System.loadLibrary("makeup_sdk_android"); }

    public MakeupSdkJava() { this(1); }
    public MakeupSdkJava(int manifestVersion) {
        handle = nativeCreate(manifestVersion);
        if (handle == 0) throw new IllegalStateException("Unable to create MakeupSdk");
    }

    public int initialize() { return nativeInitialize(handle); }
    public int pump(int maxOperations) { return nativePump(handle, maxOperations); }
    public int start() { return nativeStart(handle); }
    public int stop() { return nativeStop(handle); }
    public int apply(int category, int finish, long patternId, int argb, float intensity) {
        return nativeApply(handle, category, finish, patternId, argb, intensity);
    }
    public int clear(int category) { return nativeClear(handle, category); }
    public int clearAll() { return nativeClearAll(handle); }
    public int capture() { return nativeCapture(handle); }
    public int state() { return nativeGetState(handle); }
    public int[] capabilities() { return nativeGetCapabilities(handle); }
    public long[] pollEvent() { return nativePollEvent(handle); }

    public int dispose() {
        if (handle == 0) return STATUS_OK;
        int status = nativeDispose(handle);
        nativeDestroy(handle);
        handle = 0;
        return status;
    }

    @Override public void close() { dispose(); }

    private static native long nativeCreate(int manifestVersion);
    private static native int nativeInitialize(long handle);
    private static native int nativePump(long handle, int maxOperations);
    private static native int nativeStart(long handle);
    private static native int nativeStop(long handle);
    private static native int nativeApply(long handle, int category, int finish, long patternId, int argb, float intensity);
    private static native int nativeClear(long handle, int category);
    private static native int nativeClearAll(long handle);
    private static native int nativeCapture(long handle);
    private static native int nativeDispose(long handle);
    private static native int nativeDestroy(long handle);
    private static native int nativeGetState(long handle);
    private static native int[] nativeGetCapabilities(long handle);
    private static native long[] nativePollEvent(long handle);
}
