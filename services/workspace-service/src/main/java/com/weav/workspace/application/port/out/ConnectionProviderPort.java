package com.weav.workspace.application.port.out;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;

/**
 * Provider-specific connection configuration and verification boundary.
 *
 * <p>Implementations live in infrastructure. The application layer only
 * knows the small contract and never depends on a provider SDK or HTTP
 * client.</p>
 */
public interface ConnectionProviderPort {

    ConnectionProvider provider();

    void validateConfig(ConnectionAuthType authType, Map<String, Object> config);

    ConnectionTestResult test(
            Connection connection,
            Map<String, Object> decryptedCredential);
}
