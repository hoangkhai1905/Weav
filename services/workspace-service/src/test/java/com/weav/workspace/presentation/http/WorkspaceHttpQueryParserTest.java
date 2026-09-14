package com.weav.workspace.presentation.http;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.domain.query.WorkspaceSort;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkspaceHttpQueryParserTest {

    @Test
    void acceptsOnlyPublishedWorkspaceSortsAndDirections() {
        var query = WorkspaceHttpQueryParser.workspaceList(
                null, "OWNER", 0, 10, "createdAt", "desc");

        assertEquals(WorkspaceSort.CREATED_AT, query.sort());
        assertEquals(SortDirection.DESC, query.direction());
    }

    @Test
    void rejectsInvalidWorkspaceSortRolePageAndDirection() {
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.workspaceList(
                null, null, 0, 10, "displayName", "asc"));
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.workspaceList(
                null, "owner", 0, 10, "name", "asc"));
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.workspaceList(
                null, null, -1, 10, "name", "asc"));
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.workspaceList(
                null, null, 0, 10, "name", "sideways"));
    }

    @Test
    void acceptsIdentityOwnedMemberDisplayNameSortAndWorkspaceOwnedSorts() {
        var identityQuery = WorkspaceHttpQueryParser.memberList(
                "Ada", "MEMBER", null, null, 0, 20, "displayName", "asc");
        var workspaceQuery = WorkspaceHttpQueryParser.memberList(
                null, null, null, null, 0, 20, "joinedAt", "desc");

        assertEquals(MemberSort.DISPLAY_NAME, identityQuery.sort());
        assertEquals(MemberSort.JOINED_AT, workspaceQuery.sort());
        assertEquals(SortDirection.DESC, workspaceQuery.direction());
    }

    @Test
    void rejectsOversizedSearchAndInvalidMemberSort() {
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.memberList(
                "x".repeat(121), null, null, null, 0, 20, "displayName", "asc"));
        assertThrows(BadRequestException.class, () -> WorkspaceHttpQueryParser.memberList(
                null, null, null, null, 0, 20, "name", "asc"));
    }
}
