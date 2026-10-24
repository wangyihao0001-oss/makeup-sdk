package com.wangyihao0001.makeupsdk;

/** Thin Android facade over the shared Makeup SDK C ABI. */
public final class MakeupSdk implements AutoCloseable {
    public static final int STATUS_OK = 0;
    public static final int STATE_ERROR = 7;

    static {
        System.loadLibrary("makeup_sdk_android");
    }

    private long handle;

    public MakeupSdk() {
        this(1);
    }

    public MakeupSdk(int manifestVersion) {
        handle = nativeCreate(manifestVersion);
        if (handle == 0) throw new IllegalStateException("Unable to create MakeupSdk");
    }

    public int initialize() { return nativeInitialize(handle); }
    public int pump(int maxOperations) { return nativePump(handle, maxOperations); }
    public int start() { return nativeStart(handle); }
    public int stop() { return nativeStop(handle); }
    public int state() { return nativeGetState(handle); }
    public int[] capabilities() { return nativeGetCapabilities(handle); }

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
    private static native int nativeDispose(long handle);
    private static native int nativeDestroy(long handle);
    private static native int nativeGetState(long handle);
    private static native int[] nativeGetCapabilities(long handle);
}
