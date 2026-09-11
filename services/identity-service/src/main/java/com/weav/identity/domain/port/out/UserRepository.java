package com.weav.identity.domain.port.out;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserPage;
import com.weav.identity.domain.valueobject.UserStatus;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository {
    User save(User user);
    Optional<User> findById(UUID id);
    Optional<User> findByIdForUpdate(UUID id);
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
    default UserPage findPage(String search, UserStatus status, int page, int size) {
        throw new UnsupportedOperationException("user paging is not available");
    }
}
