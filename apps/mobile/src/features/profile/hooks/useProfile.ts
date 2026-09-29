import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import { expireAuthSession } from '../../auth/auth-session.runtime';
import type { UserProfile } from '../../../domain/auth/auth.types';
import type { NotificationSessionScope } from '../../../domain/notification/notification.types';
import {
  canApplyProfileResponse,
  createProfileSubmissionGate,
  normalizeDisplayName,
  validateDisplayName,
} from '../profile.utils';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../auth/auth-session.scope';
import { showMilestoneToastForSession } from '../../feedback/milestone-toast';

export const profileKeys = {
  current: (userId: string) => ['current-user', userId] as const,
};

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'UNAUTHORIZED'
  );
}

export function useProfile() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const user = useAuthStore((state) => state.user);
  const [displayName, setDisplayNameState] = useState(user?.name ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const previousUserId = useRef(userId);
  const submissionGate = useRef(createProfileSubmissionGate());

  const currentUserQuery = useQuery<UserProfile | null>({
    queryKey: userId ? profileKeys.current(userId) : ['current-user', 'anonymous'],
    enabled: isAuthenticated && Boolean(userId),
    queryFn: () => authRepository.getCurrentUser(),
    retry: false,
  });

  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    dirtyRef.current = false;
    setDisplayNameState(user?.name ?? '');
    setValidationError(null);
    setSubmitError(null);
  }, [user?.name, userId]);

  useEffect(() => {
    const current = useAuthStore.getState();
    if (
      currentUserQuery.data &&
      userId &&
      canApplyProfileResponse(
        userId,
        current.user?.id ?? null,
        current.isAuthenticated,
        currentUserQuery.data,
      )
    ) {
      current.setUserProfileIfCurrent(currentUserQuery.data, userId);
      if (!dirtyRef.current) setDisplayNameState(currentUserQuery.data.name);
    }
  }, [currentUserQuery.data, userId]);

  useEffect(() => {
    if (currentUserQuery.isSuccess && currentUserQuery.data === null && userId) {
      void expireAuthSession();
    }
  }, [currentUserQuery.data, currentUserQuery.isSuccess, userId]);

  const updateMutation = useMutation<
    UserProfile,
    unknown,
    { displayName: string | null; scope: NotificationSessionScope }
  >({
    mutationFn: async ({ displayName: nextDisplayName, scope }) => {
      if (!isAuthSessionScopeCurrent(scope)) {
        throw { code: 'UNAUTHORIZED', message: 'Please sign in again.' };
      }
      return authRepository.updateCurrentUser(nextDisplayName);
    },
    retry: false,
    onSuccess: (updated, variables) => {
      const current = useAuthStore.getState();
      if (
        !isAuthSessionScopeCurrent(variables.scope) ||
        !canApplyProfileResponse(
          variables.scope.userId,
          current.user?.id ?? null,
          current.isAuthenticated,
          updated,
        )
      ) {
        return;
      }
      current.setUserProfileIfCurrent(updated, variables.scope.userId);
      queryClient.setQueryData(profileKeys.current(variables.scope.userId), updated);
      showMilestoneToastForSession(variables.scope, 'profile.updated');
    },
  });

  const setDisplayName = (value: string) => {
    dirtyRef.current = true;
    setDisplayNameState(value);
    setValidationError(null);
    setSubmitError(null);
  };

  const save = async (): Promise<void> => {
    const nextDisplayName = normalizeDisplayName(displayName);
    const validation = validateDisplayName(displayName);
    setValidationError(validation);
    setSubmitError(null);
    if (validation || !userId || !isAuthenticated) return;
    if (!submissionGate.current.tryStart()) return;

    const capturedScope = captureAuthSessionScope();
    if (!capturedScope || capturedScope.userId !== userId) {
      submissionGate.current.finish();
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({
        displayName: nextDisplayName,
        scope: capturedScope,
      });
      const current = useAuthStore.getState();
      if (
        isAuthSessionScopeCurrent(capturedScope) &&
        canApplyProfileResponse(
          capturedScope.userId,
          current.user?.id ?? null,
          current.isAuthenticated,
          updated,
        )
      ) {
        dirtyRef.current = false;
        setDisplayNameState(updated.name);
      }
    } catch (error) {
      if (
        isUnauthorizedError(error) && isAuthSessionScopeCurrent(capturedScope)
      ) {
        void expireAuthSession();
      }
      if (isAuthSessionScopeCurrent(capturedScope)) {
        setSubmitError(errorMessage(error, 'Could not save your profile. Please try again.'));
      }
    } finally {
      submissionGate.current.finish();
    }
  };

  const loadError = currentUserQuery.isError
    ? errorMessage(currentUserQuery.error, 'Could not load your profile. Please try again.')
    : currentUserQuery.isSuccess && currentUserQuery.data === null
      ? 'Your session has expired. Please sign in again.'
      : null;

  return {
    profile: currentUserQuery.data ?? user,
    displayName,
    setDisplayName,
    save,
    isLoading: currentUserQuery.isPending,
    isSaving: updateMutation.isPending,
    loadError,
    validationError,
    submitError,
    retryLoad: currentUserQuery.refetch,
  };
}
