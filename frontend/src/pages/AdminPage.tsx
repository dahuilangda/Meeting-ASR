import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { AdminUserManagement } from '../components/AdminUserManagement';
import { Tabs, Tab, Alert } from 'react-bootstrap';
import { getCurrentUser, User } from '../api/user';

export const AdminPage: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);

        // Check if user has admin privileges
        if (user.role !== 'admin' && user.role !== 'super_admin') {
          setError('Access denied. Admin privileges required.');
        }
      } catch (error: any) {
        setError(error.response?.data?.detail || 'Failed to load user information');
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '50vh' }}>
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-4">
        <Alert variant="danger">
          <h4>Access Denied</h4>
          <p>{error}</p>
        </Alert>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>Administration</h1>
        <div>
          <span className="badge bg-danger me-2">
            {currentUser.role.replace('_', ' ').toUpperCase()}
          </span>
          <span className="text-muted">
            Logged in as: {currentUser.username}
          </span>
        </div>
      </div>

      <Tabs defaultActiveKey="users" id="admin-tabs" className="mb-4">
        <Tab eventKey="users" title="User Management">
          <AdminUserManagement />
        </Tab>
      </Tabs>
    </div>
  );
};