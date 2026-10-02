import type { PageResult } from '../../domain/workspace/workspace.types';

export async function loadAllPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  label: string,
  isScopeCurrent: () => boolean = () => true,
): Promise<PageResult<T>> {
  const first = await fetchPage(0);
  assertScope(label, isScopeCurrent);

  const items = [...first.items];
  for (let page = first.page + 1; page < first.totalPages; page += 1) {
    const next = await fetchPage(page);
    assertScope(label, isScopeCurrent);
    items.push(...next.items);
  }

  return { ...first, items };
}

function assertScope(label: string, isScopeCurrent: () => boolean) {
  if (!isScopeCurrent()) {
    throw new Error(`${label} scope changed before the response was applied.`);
  }
}
