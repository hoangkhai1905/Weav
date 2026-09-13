package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.domain.exception.UserAlreadyMemberException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.application.port.out.TransactionRunner;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MembershipRepositoryAdapterIntegrationTest {

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private TransactionRunner transactionRunner;

    @Test
    void concurrentDuplicateMembershipInsertTranslatesOnlyTheLosingUniqueConstraint() throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew("Concurrent members", ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            return saved;
        });

        CyclicBarrier ready = new CyclicBarrier(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Callable<Throwable> attempt = () -> {
                ready.await(10, TimeUnit.SECONDS);
                try {
                    transactionRunner.requiresNew(() -> {
                        membershipRepository.save(Membership.member(workspace.getId(), memberId));
                        return Boolean.TRUE;
                    });
                    return null;
                } catch (Throwable exception) {
                    return unwrap(exception);
                }
            };

            List<Future<Throwable>> futures = executor.invokeAll(List.of(attempt, attempt));
            List<Throwable> outcomes = new ArrayList<>();
            for (Future<Throwable> future : futures) {
                outcomes.add(future.get());
            }

            assertThat(outcomes.stream().filter(java.util.Objects::isNull).count()).isEqualTo(1);
            assertThat(outcomes.stream().filter(java.util.Objects::nonNull).toList())
                    .singleElement()
                    .isInstanceOf(UserAlreadyMemberException.class);
            assertThat(membershipRepository.findByWorkspaceIdAndUserId(workspace.getId(), memberId))
                    .isPresent();
        } finally {
            executor.shutdownNow();
            executor.awaitTermination(10, TimeUnit.SECONDS);
        }
    }

    @Test
    void unrelatedForeignKeyFailureRemainsADataIntegrityViolation() {
        UUID missingWorkspace = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();

        assertThatThrownBy(() -> transactionRunner.requiresNew(() -> {
            membershipRepository.save(Membership.member(missingWorkspace, memberId));
            return Boolean.TRUE;
        }))
                .isInstanceOf(DataIntegrityViolationException.class)
                .isNotInstanceOf(UserAlreadyMemberException.class);
    }

    private Throwable unwrap(Throwable exception) {
        Throwable current = exception;
        while ((current instanceof ExecutionException || current instanceof RuntimeException)
                && current.getCause() != null
                && !(current instanceof UserAlreadyMemberException)
                && !(current instanceof DataIntegrityViolationException)) {
            current = current.getCause();
        }
        return current;
    }
}
