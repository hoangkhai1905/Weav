import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { WorkspaceMember } from '../types/workflow.types';

export const workspaceApi = {
  async getMembers(): Promise<WorkspaceMember[]> {
    await delay(200);
    return getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
  },

  async updatePublishPermission(memberId: string, canPublish: boolean): Promise<WorkspaceMember> {
    await delay(250);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    const idx = members.findIndex((m) => m.id === memberId);
    if (idx === -1) throw new Error('Member not found');
    members[idx].canPublishWorkflow = canPublish;
    setStorage(STORAGE_KEYS.MEMBERS, members);
    return members[idx];
  },

  async inviteMember(email: string, role: 'OWNER' | 'MEMBER', canPublish: boolean): Promise<WorkspaceMember> {
    await delay(300);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    const nameFromEmail = email.split('@')[0].replace('.', ' ');
    const newMember: WorkspaceMember = {
      id: 'user-' + Date.now(),
      name: nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1),
      email,
      role,
      canPublishWorkflow: canPublish,
      joinedAt: new Date().toISOString(),
    };
    members.push(newMember);
    setStorage(STORAGE_KEYS.MEMBERS, members);
    return newMember;
  },

  async removeMember(memberId: string): Promise<void> {
    await delay(200);
    const members = getStorage<WorkspaceMember[]>(STORAGE_KEYS.MEMBERS, []);
    setStorage(
      STORAGE_KEYS.MEMBERS,
      members.filter((m) => m.id !== memberId)
    );
  },
};
