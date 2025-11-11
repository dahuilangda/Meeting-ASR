import { apiClient } from '../api';

export interface User {
  id: number;
  username: string;
  email?: string;
  full_name?: string;
  role: 'user' | 'admin' | 'super_admin';
  is_active: boolean;
  created_at: string;
  last_login?: string;
  job_count: number;
}

export interface UserUpdate {
  email?: string;
  full_name?: string;
  role?: 'user' | 'admin' | 'super_admin';
  is_active?: boolean;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface PasswordReset {
  new_password: string;
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    inactive: number;
  };
  jobs: {
    total: number;
    completed: number;
    processing: number;
    failed: number;
  };
}

export interface UserListResponse {
  items: User[];
  total: number;
}

// User profile APIs
export const getCurrentUser = async (): Promise<User> => {
  const response = await apiClient.get('/users/me');
  return response.data as User;
};

export const updateCurrentUser = async (userData: UserUpdate): Promise<User> => {
  const response = await apiClient.put('/users/me', userData);
  return response.data as User;
};

export const changePassword = async (passwordData: PasswordChange): Promise<{ message: string }> => {
  const response = await apiClient.post('/users/change_password', passwordData);
  return response.data as { message: string };
};

// Admin user management APIs
export const getAllUsers = async (
  skip = 0,
  limit = 100,
  includeInactive = false,
  search?: string
): Promise<UserListResponse> => {
  const response = await apiClient.get('/admin/users', {
    params: {
      skip,
      limit,
      include_inactive: includeInactive,
      search: search && search.trim().length > 0 ? search.trim() : undefined,
    }
  });
  return response.data as UserListResponse;
};

export const getUserById = async (userId: number): Promise<User> => {
  const response = await apiClient.get(`/admin/users/${userId}`);
  return response.data as User;
};

export const updateUserByAdmin = async (
  userId: number,
  userData: UserUpdate
): Promise<User> => {
  const response = await apiClient.put(`/admin/users/${userId}`, userData);
  return response.data as User;
};

export const resetUserPassword = async (
  userId: number,
  passwordData: PasswordReset
): Promise<{ message: string }> => {
  const response = await apiClient.post(`/admin/users/${userId}/reset_password`, passwordData);
  return response.data as { message: string };
};

export const activateUser = async (userId: number): Promise<{ message: string }> => {
  const response = await apiClient.post(`/admin/users/${userId}/activate`);
  return response.data as { message: string };
};

export const deactivateUser = async (userId: number): Promise<{ message: string }> => {
  const response = await apiClient.post(`/admin/users/${userId}/deactivate`);
  return response.data as { message: string };
};

export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await apiClient.get('/admin/stats');
  return response.data as AdminStats;
};