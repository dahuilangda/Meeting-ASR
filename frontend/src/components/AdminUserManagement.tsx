import React, { useState, useEffect } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Modal,
  Spinner,
  Table,
  Badge,
  Pagination,
  InputGroup,
} from 'react-bootstrap';
import {
  getAllUsers,
  getUserById,
  updateUserByAdmin,
  resetUserPassword,
  activateUser,
  deactivateUser,
  User,
  UserUpdate,
  PasswordReset,
  AdminStats,
} from '../api/user';

export const AdminUserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize] = useState(10);

  // Search and filters
  const [searchTerm, setSearchTerm] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  // Modals
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Forms
  const [editForm, setEditForm] = useState<UserUpdate>({
    email: '',
    full_name: '',
    role: 'user',
    is_active: true,
  });
  const [passwordForm, setPasswordForm] = useState<PasswordReset>({
    new_password: '',
  });

  useEffect(() => {
    loadUsers();
    loadStats();
  }, [currentPage, includeInactive, searchTerm]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (currentPage - 1) * pageSize;
      const userList = await getAllUsers(offset, pageSize, includeInactive);

      // Filter by search term if provided
      let filteredUsers = userList;
      if (searchTerm) {
        filteredUsers = userList.filter(
          (user) =>
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.email && user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (user.full_name && user.full_name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
      }

      setUsers(filteredUsers);
      // Note: In a real implementation, you'd get total count from API
      setTotalPages(Math.ceil(filteredUsers.length / pageSize));
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await getAdminStats();
      setStats(statsData);
    } catch (error: any) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleEditUser = async (user: User) => {
    setSelectedUser(user);
    setEditForm({
      email: user.email || '',
      full_name: user.full_name || '',
      role: user.role,
      is_active: user.is_active,
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updatedUser = await updateUserByAdmin(selectedUser.id, editForm);
      setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
      setSuccess('User updated successfully!');
      setShowEditModal(false);
      loadStats();
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (user: User) => {
    if (!window.confirm(`Are you sure you want to reset the password for ${user.username}?`)) {
      return;
    }

    setSelectedUser(user);
    setPasswordForm({ new_password: '' });
    setShowPasswordModal(true);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await resetUserPassword(selectedUser.id, passwordForm);
      setSuccess(`Password reset successfully for ${selectedUser.username}`);
      setShowPasswordModal(false);
      setPasswordForm({ new_password: '' });
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    const action = user.is_active ? 'deactivate' : 'activate';
    if (!window.confirm(`Are you sure you want to ${action} ${user.username}?`)) {
      return;
    }

    try {
      if (user.is_active) {
        await deactivateUser(user.id);
      } else {
        await activateUser(user.id);
      }
      setSuccess(`User ${action}d successfully!`);
      loadUsers();
      loadStats();
    } catch (error: any) {
      setError(error.response?.data?.detail || `Failed to ${action} user`);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'danger';
      case 'admin':
        return 'warning';
      default:
        return 'primary';
    }
  };

  return (
    <div className="admin-user-management">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>User Management</h2>
        <Button variant="success" onClick={() => window.location.reload()}>
          <i className="bi bi-arrow-clockwise me-2"></i>
          Refresh
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {/* Statistics Cards */}
      {stats && (
        <div className="row mb-4">
          <div className="col-md-3">
            <Card className="text-center">
              <Card.Body>
                <h3 className="text-primary">{stats.users.total}</h3>
                <p className="mb-0">Total Users</p>
              </Card.Body>
            </Card>
          </div>
          <div className="col-md-3">
            <Card className="text-center">
              <Card.Body>
                <h3 className="text-success">{stats.users.active}</h3>
                <p className="mb-0">Active Users</p>
              </Card.Body>
            </Card>
          </div>
          <div className="col-md-3">
            <Card className="text-center">
              <Card.Body>
                <h3 className="text-danger">{stats.users.inactive}</h3>
                <p className="mb-0">Inactive Users</p>
              </Card.Body>
            </Card>
          </div>
          <div className="col-md-3">
            <Card className="text-center">
              <Card.Body>
                <h3 className="text-info">{stats.jobs.total}</h3>
                <p className="mb-0">Total Jobs</p>
              </Card.Body>
            </Card>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-4">
        <Card.Body>
          <div className="row align-items-center">
            <div className="col-md-6">
              <InputGroup>
                <Form.Control
                  type="text"
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </InputGroup>
            </div>
            <div className="col-md-6">
              <Form.Check
                type="checkbox"
                label="Include inactive users"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
            </div>
          </div>
        </Card.Body>
      </Card>

      {/* Users Table */}
      <Card>
        <Card.Header>
          <h5 className="mb-0">Users ({users.length})</h5>
        </Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : (
            <>
              <Table striped hover responsive>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Jobs</th>
                    <th>Member Since</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.full_name || '-'}</td>
                      <td>{user.email || '-'}</td>
                      <td>
                        <Badge bg={getRoleBadgeVariant(user.role)}>
                          {user.role.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </td>
                      <td>
                        <Badge bg={user.is_active ? 'success' : 'danger'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>{user.job_count}</td>
                      <td>{new Date(user.created_at).toLocaleDateString()}</td>
                      <td>
                        <div className="btn-group btn-group-sm">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleEditUser(user)}
                          >
                            <i className="bi bi-pencil"></i>
                          </Button>
                          <Button
                            variant="outline-warning"
                            size="sm"
                            onClick={() => handleResetPassword(user)}
                          >
                            <i className="bi bi-key"></i>
                          </Button>
                          <Button
                            variant={user.is_active ? 'outline-danger' : 'outline-success'}
                            size="sm"
                            onClick={() => handleToggleActive(user)}
                          >
                            <i className={`bi bi-${user.is_active ? 'pause' : 'play'}`}></i>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="d-flex justify-content-center mt-4">
                  <Pagination>
                    <Pagination.Prev
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    />
                    {[...Array(totalPages)].map((_, index) => (
                      <Pagination.Item
                        key={index + 1}
                        active={currentPage === index + 1}
                        onClick={() => setCurrentPage(index + 1)}
                      >
                        {index + 1}
                      </Pagination.Item>
                    ))}
                    <Pagination.Next
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    />
                  </Pagination>
                </div>
              )}
            </>
          )}
        </Card.Body>
      </Card>

      {/* Edit User Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit User</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleEditSubmit}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                value={selectedUser?.username || ''}
                disabled
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Full Name</Form.Label>
              <Form.Control
                type="text"
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Role</Form.Label>
              <Form.Select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as any })}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                label="Active"
                checked={editForm.is_active}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowEditModal(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Save Changes'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal show={showPasswordModal} onHide={() => setShowPasswordModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Reset Password</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handlePasswordSubmit}>
          <Modal.Body>
            <p>Reset password for: <strong>{selectedUser?.username}</strong></p>

            <Form.Group className="mb-3">
              <Form.Label>New Password</Form.Label>
              <Form.Control
                type="password"
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm({ new_password: e.target.value })}
                required
                minLength={6}
              />
              <Form.Text className="text-muted">
                Password must be at least 6 characters long
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => setShowPasswordModal(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="warning" disabled={loading}>
              {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Reset Password'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
};