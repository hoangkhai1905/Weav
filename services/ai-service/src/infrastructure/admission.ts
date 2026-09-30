/** Local, per-replica, no queue (spec §5). The returned release is idempotent. */
export class Admission {
  private total = 0;
  private readonly perWorkspace = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly maxPerWorkspace: number,
  ) {}

  tryAcquire(workspaceId: string): (() => void) | null {
    const current = this.perWorkspace.get(workspaceId) ?? 0;
    if (this.total >= this.max || current >= this.maxPerWorkspace) return null;
    this.total++;
    this.perWorkspace.set(workspaceId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const left = (this.perWorkspace.get(workspaceId) ?? 1) - 1;
      if (left === 0) this.perWorkspace.delete(workspaceId);
      else this.perWorkspace.set(workspaceId, left);
    };
  }
}
