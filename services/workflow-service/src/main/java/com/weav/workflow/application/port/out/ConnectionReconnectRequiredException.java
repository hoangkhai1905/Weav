package com.weav.workflow.application.port.out;

/** Workspace reports the stored authorization is unusable (e.g. missing scopes); the user must reconnect. */
public final class ConnectionReconnectRequiredException extends RuntimeException {

    public static final String CODE = "CONNECTION_RECONNECT_REQUIRED";

    public ConnectionReconnectRequiredException() {
        super("The connection must be reconnected");
    }
}
