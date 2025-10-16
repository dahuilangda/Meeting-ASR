import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { UserSettings } from '../components/UserSettings';
import { getCurrentUser, User } from '../api/user';

export const UserSettingsPage: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
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
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="container mt-4">
      <UserSettings
        currentUser={currentUser}
        onUserUpdate={setCurrentUser}
      />
    </div>
  );
};