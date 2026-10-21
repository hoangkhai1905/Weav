import { api } from './client';

export type AdminUserStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  systemRole: 'USER' | 'ADMIN';
  status: AdminUserStatus;
  createdAt: string;
  emailVerifiedAt: string | null;
  avatarPresent: boolean;
}

export interface UserPage {
  items: AdminUser[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface ListUsersParams {
  page: number;
  size: number;
  search?: string;
  status?: AdminUserStatus;
}

export const listUsers = async ({ page, size, search, status }: ListUsersParams): Promise<UserPage> =>
  (await api.get<UserPage>('/api/admin/users', { params: { page, size, search: search || undefined, status } })).data;

export const getUser = async (id: string): Promise<AdminUser> =>
  (await api.get<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`)).data;

export const changeStatus = async (id: string, status: AdminUserStatus): Promise<AdminUser> =>
  (await api.patch<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/status`, { status })).data;
