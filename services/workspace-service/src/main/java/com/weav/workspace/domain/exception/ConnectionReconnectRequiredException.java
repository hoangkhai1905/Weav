package com.weav.workspace.domain.exception;

/** The stored Google authorization cannot be used; the user must reconnect the connection. */
public class ConnectionReconnectRequiredException extends InvalidStateException {

    public static final String CODE = "CONNECTION_RECONNECT_REQUIRED";

    public ConnectionReconnectRequiredException(String message) {
        super(CODE, message);
    }
}
