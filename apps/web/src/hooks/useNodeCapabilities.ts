import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "../api/workflow.api";
import { useAuthStore } from "../store/useAuthStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

/**
 * OCR sources the Workflow Service can run right now ("url", "artifact", "file"); [] when OCR is off,
 * undefined while loading. A failed lookup counts as off so the builder never over-promises.
 */
export function useOcrSources(): readonly string[] | undefined {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const { data, isError } = useQuery({
    queryKey: ["node-capabilities", userId ?? "anonymous", workspaceId ?? "none"],
    enabled: Boolean(authenticated && userId && workspaceId),
    queryFn: () => workflowApi.getNodeCapabilities(workspaceId!),
    staleTime: 60_000,
    retry: false,
  });
  if (isError) return [];
  const ocr = data?.nodes["ocr.extract"];
  return data ? (ocr?.available ? ocr.sources : []) : undefined;
}
