package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceIdempotencyPort;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.IdempotencyKeyReusedException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;
import java.util.regex.Pattern;

@Service
public final class CreateWorkspaceUseCase {

    private static final int MAX_GENERATED_NAME_ATTEMPTS = 3;
    private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[A-Za-z0-9._:-]{8,128}");

    private final WorkspaceRepository workspaceRepository;
    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;
    private final WorkspaceNotificationRecorder notifications;
    private final WorkspaceIdempotencyPort idempotency;

    /** Without an idempotency store; Idempotency-Key requests are rejected. */
    public CreateWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            WorkspaceNotificationRecorder notifications) {
        this(workspaceRepository, membershipRepository, transactionRunner, notifications, null);
    }

    @Autowired
    public CreateWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            WorkspaceNotificationRecorder notifications,
            WorkspaceIdempotencyPort idempotency) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.notifications = Objects.requireNonNull(notifications);
        this.idempotency = idempotency;
    }

    public WorkspaceResponse execute(CreateWorkspaceCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        validateExplicitName(command.name());
        if (command.idempotencyKey() != null
                && (idempotency == null || !IDEMPOTENCY_KEY.matcher(command.idempotencyKey()).matches())) {
            throw new BadRequestException("Idempotency-Key is invalid");
        }

        int attempts = command.hasExplicitName() ? 1 : MAX_GENERATED_NAME_ATTEMPTS;
        for (int attempt = 0; attempt < attempts; attempt++) {
            try {
                return transactionRunner.requiresNew(() -> createInTransaction(command));
            } catch (WorkspaceNameAlreadyExistsException exception) {
                if (!command.hasExplicitName() && attempt + 1 < attempts) {
                    continue;
                }
                throw exception;
            }
        }
        throw new WorkspaceNameAlreadyExistsException();
    }

    private WorkspaceResponse createInTransaction(CreateWorkspaceCommand command) {
        String key = command.idempotencyKey();
        String requestHash = key == null ? null : requestHash(command.name());
        if (key != null) {
            var existing = idempotency.find(command.actorUserId(), key);
            if (existing.isPresent()) {
                return replay(existing.get(), requestHash);
            }
        }
        String name = chooseName(command);
        String normalizedName;
        try {
            name = Workspace.normalizeDisplayName(name);
            normalizedName = Workspace.normalizeName(name);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }

        if (workspaceRepository.existsOwnedNameNormalized(
                command.actorUserId(), normalizedName, null)) {
            throw new WorkspaceNameAlreadyExistsException();
        }

        Workspace workspace = Workspace.createNew(name, command.actorUserId());
        if (key != null
                && !idempotency.claim(command.actorUserId(), key, workspace.getId(), requestHash)) {
            // A concurrent request with the same key committed first: return its workspace.
            return replay(idempotency.find(command.actorUserId(), key).orElseThrow(), requestHash);
        }
        Workspace persisted = workspaceRepository.save(workspace);
        membershipRepository.save(Membership.owner(persisted.getId(), command.actorUserId()));
        notifications.recordCreated(persisted.getId(), command.actorUserId(), persisted.getName());
        return WorkspaceResponse.from(persisted);
    }

    private WorkspaceResponse replay(WorkspaceIdempotencyPort.Entry entry, String requestHash) {
        if (!entry.requestHash().equals(requestHash)) {
            throw new IdempotencyKeyReusedException();
        }
        return WorkspaceResponse.from(workspaceRepository.findById(entry.workspaceId())
                .orElseThrow(() -> new InvalidStateException("Idempotent workspace no longer exists")));
    }

    private static String requestHash(String name) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((name == null ? "name:null" : "name:" + name).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private String chooseName(CreateWorkspaceCommand command) {
        if (command.hasExplicitName()) {
            return command.name();
        }
        int max = workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(command.actorUserId());
        if (max < 0 || max == Integer.MAX_VALUE) {
            throw new InvalidStateException("Workspace default name numbering exhausted");
        }
        return "My workspace " + (max + 1);
    }

    private void validateExplicitName(String name) {
        if (name != null && name.isBlank()) {
            throw new BadRequestException("Workspace name must not be blank");
        }
    }
}
