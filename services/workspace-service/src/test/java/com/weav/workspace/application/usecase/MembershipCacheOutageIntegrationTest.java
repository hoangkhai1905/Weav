package com.weav.workspace.application.usecase;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.application.port.out.TransactionRunner;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MembershipCacheOutageIntegrationTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private ResolveWorkspaceAccessUseCase resolveWorkspaceAccessUseCase;

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
        registry.add("spring.data.redis.timeout", () -> "250ms");
        registry.add("spring.data.redis.connect-timeout", () -> "250ms");
    }

    @Test
    void resolverFallsBackToPostgresWhenValkeyBecomesUnavailable() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew("Cache outage", ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            membershipRepository.save(Membership.member(saved.getId(), memberId));
            return saved;
        });

        valkey.stop();

        WorkspaceAccessSnapshot snapshot = resolveWorkspaceAccessUseCase.execute(
                workspace.getId(), memberId);

        assertThat(snapshot.workspaceId()).isEqualTo(workspace.getId());
        assertThat(snapshot.userId()).isEqualTo(memberId);
    }
}
