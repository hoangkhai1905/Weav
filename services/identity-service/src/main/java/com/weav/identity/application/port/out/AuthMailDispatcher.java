package com.weav.identity.application.port.out;

/**
 * Framework-free admission boundary for asynchronous authentication mail.
 *
 * <p>A lease reserves one bounded executor slot before account lookup. The
 * caller either submits one job (including an eligible-path no-op) or closes
 * the lease to release the reservation.</p>
 */
public interface AuthMailDispatcher extends AutoCloseable {

    Lease reserve();

    interface Lease extends AutoCloseable {

        void dispatch(AuthMailSender.Message message, Runnable onFailure);

        @Override
        void close();
    }

    @Override
    void close();
}
