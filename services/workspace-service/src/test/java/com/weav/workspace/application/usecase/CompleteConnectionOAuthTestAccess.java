package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;

/**
 * Test-scoped access to the package-private direct completion seam of
 * {@link CompleteConnectionOAuthUseCase}. It lives only under src/test, so production code cannot
 * reach the path that skips the authenticated initiator binding.
 */
public final class CompleteConnectionOAuthTestAccess {

    private CompleteConnectionOAuthTestAccess() {
    }

    public static ConnectionTestResult completeDirectly(
            CompleteConnectionOAuthUseCase useCase, String state, String authorizationCode) {
        return useCase.execute(state, authorizationCode);
    }
}
