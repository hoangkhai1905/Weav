package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AdminUserResult;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.exception.DomainException;
import com.weav.identity.domain.exception.ForbiddenException;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class ChangeUserStatusUseCase {

    private static final Logger log = LoggerFactory.getLogger(ChangeUserStatusUseCase.class);
    private static final String AUTHENTICATION_FAILED = "Authentication failed";
    private static final String STATUS_ACTION = "CHANGE_USER_STATUS";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public ChangeUserStatusUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public AdminUserResult execute(
            UUID actorId,
            UUID sessionId,
            UUID targetUserId,
            UserStatus requestedStatus,
            String correlationId
    ) {
        Objects.requireNonNull(actorId, "actorId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(targetUserId, "targetUserId must not be null");
        Objects.requireNonNull(requestedStatus, "requestedStatus must not be null");
        String safeCorrelationId = safeCorrelationId(correlationId);

        try {
            AdminUserResult result = transactionRunner.required(() -> {
                User first;
                User second;
                boolean actorIsFirst = actorId.compareTo(targetUserId) <= 0;
                if (actorIsFirst) {
                    first = lockUserIfPresent(actorId);
                    second = actorId.equals(targetUserId) ? first : lockUserIfPresent(targetUserId);
                } else {
                    first = lockUserIfPresent(targetUserId);
                    second = lockUserIfPresent(actorId);
                }

                User actor = actorIsFirst ? first : second;
                User target = actorIsFirst ? second : first;
                if (actorId.equals(targetUserId)) {
                    target = actor;
                }
                identityGuard.requireActiveAdminForLockedUser(actor, actorId, sessionId);
                if (target == null) {
                    throw new ResourceNotFoundException("Resource not found");
                }
                if (target.getSystemRole() == SystemRole.ADMIN) {
                    throw new ConflictException("Administrator status cannot be changed");
                }

                Instant now = clock.instant();
                if (target.getStatus() != requestedStatus) {
                    target.changeStatus(requestedStatus, now);
                    target = userRepository.save(target);
                }
                if (requestedStatus == UserStatus.DISABLED) {
                    sessionRepository.revokeAllForUser(targetUserId, now);
                }
                return AdminUserResult.from(target);
            });
            audit(actorId, targetUserId, safeCorrelationId, "SUCCESS");
            return result;
        } catch (DomainException exception) {
            audit(actorId, targetUserId, safeCorrelationId, auditResult(exception));
            throw exception;
        } catch (RuntimeException exception) {
            audit(actorId, targetUserId, safeCorrelationId, "ERROR");
            throw exception;
        }
    }

    private User lockUserIfPresent(UUID userId) {
        return userRepository.findByIdForUpdate(userId).orElse(null);
    }

    private void audit(UUID actorId, UUID targetId, String correlationId, String result) {
        log.info("identity_admin_audit actorId={} targetId={} action={} result={} correlationId={}",
                actorId, targetId, STATUS_ACTION, result, correlationId);
    }

    private static String auditResult(DomainException exception) {
        if (exception instanceof UnauthorizedException) {
            return "UNAUTHORIZED";
        }
        if (exception instanceof ForbiddenException) {
            return "FORBIDDEN";
        }
        if (exception instanceof ConflictException) {
            return "CONFLICT";
        }
        if (exception instanceof ResourceNotFoundException) {
            return "NOT_FOUND";
        }
        return "REJECTED";
    }

    private static String safeCorrelationId(String value) {
        if (value == null || value.isBlank()) {
            return "generated-" + UUID.randomUUID();
        }
        String trimmed = value.trim();
        if (trimmed.length() > 128 || !trimmed.matches("[A-Za-z0-9._:-]+")) {
            return "invalid";
        }
        return trimmed;
    }
}
