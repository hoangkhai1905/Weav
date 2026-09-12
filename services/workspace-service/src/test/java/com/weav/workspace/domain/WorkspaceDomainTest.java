package com.weav.workspace.domain;

import com.weav.workspace.domain.model.Workspace;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class WorkspaceDomainTest {

    @Test
    void trimsDisplayNameAndDerivesLocaleSafeNormalizedName() {
        Workspace workspace = new Workspace(
                UUID.randomUUID(),
                " Project A ",
                UUID.randomUUID(),
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"));

        assertThat(workspace.getName()).isEqualTo("Project A");
        assertThat(workspace.getNameNormalized()).isEqualTo("project a");
    }

    @Test
    void rejectsANameThatIsBlankAfterTrimming() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new Workspace(
                        UUID.randomUUID(),
                        "  ",
                        UUID.randomUUID(),
                        Instant.now(),
                        Instant.now()));
    }

    @Test
    void rejectsAStoredNormalizedNameThatDoesNotMatchTheDisplayName() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new Workspace(
                        UUID.randomUUID(),
                        "Project A",
                        "project b",
                        UUID.randomUUID(),
                        Instant.now(),
                        Instant.now()));
    }

    @Test
    void renameRecomputesDisplayAndNormalizedNames() {
        Workspace workspace = Workspace.createNew("Initial", UUID.randomUUID());

        workspace.rename(" PROJECT B ");

        assertThat(workspace.getName()).isEqualTo("PROJECT B");
        assertThat(workspace.getNameNormalized()).isEqualTo("project b");
    }
}
