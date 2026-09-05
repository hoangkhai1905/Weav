package com.weav.identity.domain.port.out;

import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.valueobject.OAuthProvider;
import java.util.Optional;
import java.util.UUID;

public interface OAuthAccountRepository {
    OAuthAccount save(OAuthAccount account);
    Optional<OAuthAccount> findById(UUID id);
    Optional<OAuthAccount> findByProviderAndProviderUserId(OAuthProvider provider, String providerUserId);
}
