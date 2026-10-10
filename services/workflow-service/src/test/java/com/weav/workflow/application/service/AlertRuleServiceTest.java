package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.AlertRuleStore;
import com.weav.workflow.application.port.out.AlertRuleStore.AlertRule;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.service.AlertRuleService.RuleInput;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ConflictException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AlertRuleServiceTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-08T10:00:00Z");

    private final AlertRuleStore store = mock(AlertRuleStore.class);

    private AlertRuleService service(Set<String> capabilities) {
        return new AlertRuleService(new WorkspaceAuthorization((workspace, user) ->
                new WorkspaceAccessPort.Access(workspace, user, "MEMBER", capabilities)),
                store, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static RuleInput failures(UUID workflowId) {
        return new RuleInput("  Nightly sync  ", AlertRuleType.CONSECUTIVE_FAILURES, workflowId, 3, 30, null, null);
    }

    @Test
    void createStoresATrimmedRuleWithDefaultsForTheCaller() {
        UUID workflowId = UUID.randomUUID();
        when(store.workflowInWorkspace(WORKSPACE, workflowId)).thenReturn(true);
        when(store.insertIfBelowLimit(any(), eq(20))).thenReturn(true);

        AlertRule rule = service(Set.of("WORKFLOW_EDIT")).create(WORKSPACE, USER, failures(workflowId));

        assertEquals("Nightly sync", rule.name());
        assertEquals(60, rule.cooldownMinutes());
        assertTrue(rule.enabled());
        assertEquals(USER, rule.createdBy());
        assertEquals(30, rule.windowMinutes());
        verify(store).insertIfBelowLimit(rule, 20);
    }

    @Test
    void changingRulesNeedsEditWhileListingOnlyNeedsMonitor() {
        AlertRuleService monitorOnly = service(Set.of("WORKFLOW_MONITOR"));

        assertThrows(ForbiddenException.class, () -> monitorOnly.create(WORKSPACE, USER, failures(null)));
        assertThrows(ForbiddenException.class,
                () -> monitorOnly.update(WORKSPACE, USER, UUID.randomUUID(), failures(null)));
        assertThrows(ForbiddenException.class, () -> monitorOnly.delete(WORKSPACE, USER, UUID.randomUUID()));
        monitorOnly.list(WORKSPACE, USER);
        assertThrows(ForbiddenException.class, () -> service(Set.of("WORKFLOW_EDIT")).list(WORKSPACE, USER));
        verify(store, never()).insertIfBelowLimit(any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void aWorkspaceCanHoldAtMostTwentyRules() {
        when(store.insertIfBelowLimit(any(), eq(20))).thenReturn(false);

        assertThrows(ConflictException.class,
                () -> service(Set.of("WORKFLOW_EDIT")).create(WORKSPACE, USER, failures(null)));
    }

    @Test
    void thresholdsAreValidatedPerRuleType() {
        AlertRuleService service = service(Set.of("WORKFLOW_EDIT"));

        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.CONSECUTIVE_FAILURES, null, 0, 30, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.CONSECUTIVE_FAILURES, null, 21, 30, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.CONSECUTIVE_FAILURES, null, 3, null, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.LONG_RUNNING, null, 86_401, null, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.LONG_RUNNING, null, 60, 10, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", AlertRuleType.LONG_RUNNING, null, 60, null, -1, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "  ", AlertRuleType.LONG_RUNNING, null, 60, null, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "x".repeat(121), AlertRuleType.LONG_RUNNING, null, 60, null, null, null)));
        assertThrows(BadRequestException.class, () -> service.create(WORKSPACE, USER, new RuleInput(
                "r", null, null, 60, null, null, null)));
        verify(store, never()).insertIfBelowLimit(any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void aRuleCannotPointAtAWorkflowOfAnotherWorkspace() {
        UUID foreign = UUID.randomUUID();
        when(store.workflowInWorkspace(WORKSPACE, foreign)).thenReturn(false);

        assertThrows(BadRequestException.class,
                () -> service(Set.of("WORKFLOW_EDIT")).create(WORKSPACE, USER, failures(foreign)));
        verify(store, never()).insertIfBelowLimit(any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void longRunningRulesAreStoredWithoutAWindow() {
        when(store.insertIfBelowLimit(any(), eq(20))).thenReturn(true);

        AlertRule rule = service(Set.of("WORKFLOW_EDIT")).create(WORKSPACE, USER, new RuleInput(
                "Slow", AlertRuleType.LONG_RUNNING, null, 120, null, 5, false));

        assertNull(rule.windowMinutes());
        assertNull(rule.workflowId());
        assertEquals(5, rule.cooldownMinutes());
        assertFalse(rule.enabled());
    }

    @Test
    void updateKeepsIdentityAndCreatorAndKeepsEnabledWhenOmitted() {
        UUID ruleId = UUID.randomUUID();
        UUID creator = UUID.randomUUID();
        Instant created = NOW.minusSeconds(3600);
        when(store.find(WORKSPACE, ruleId)).thenReturn(Optional.of(new AlertRule(ruleId, WORKSPACE, null, "Old",
                AlertRuleType.LONG_RUNNING, 10, null, 60, false, creator, created, created)));
        when(store.update(any())).thenReturn(true);

        AlertRule updated = service(Set.of("WORKFLOW_EDIT")).update(WORKSPACE, USER, ruleId, failures(null));

        assertEquals(ruleId, updated.id());
        assertEquals(creator, updated.createdBy());
        assertEquals(created, updated.createdAt());
        assertEquals(NOW, updated.updatedAt());
        assertFalse(updated.enabled());
        assertEquals(AlertRuleType.CONSECUTIVE_FAILURES, updated.type());
    }

    @Test
    void updateAndDeleteOfAnUnknownRuleAreNotFound() {
        UUID ruleId = UUID.randomUUID();
        when(store.find(WORKSPACE, ruleId)).thenReturn(Optional.empty());
        when(store.delete(WORKSPACE, ruleId)).thenReturn(false);
        AlertRuleService service = service(Set.of("WORKFLOW_EDIT"));

        assertThrows(ResourceNotFoundException.class, () -> service.update(WORKSPACE, USER, ruleId, failures(null)));
        assertThrows(ResourceNotFoundException.class, () -> service.delete(WORKSPACE, USER, ruleId));
    }
}
