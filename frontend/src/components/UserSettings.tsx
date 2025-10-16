import React, { useState, useEffect } from 'react';
import { Alert, Button, Card, Form, Modal, Spinner } from 'react-bootstrap';
import { getCurrentUser, updateCurrentUser, changePassword, User, UserUpdate, PasswordChange } from '../api/user';

interface UserSettingsProps {
  currentUser: User | null;
  onUserUpdate?: (updatedUser: User) => void;
}

export const UserSettings: React.FC<UserSettingsProps> = ({ currentUser, onUserUpdate }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Profile update form
  const [profileForm, setProfileForm] = useState<UserUpdate>({
    email: '',
    full_name: ''
  });

  // Password change form
  const [passwordForm, setPasswordForm] = useState<PasswordChange>({
    current_password: '',
    new_password: ''
  });

  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setUser(currentUser);
      setProfileForm({
        email: currentUser.email || '',
        full_name: currentUser.full_name || ''
      });
    }
  }, [currentUser]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const updatedUser = await updateCurrentUser(profileForm);
      setUser(updatedUser);
      setSuccess('Profile updated successfully!');
      if (onUserUpdate) {
        onUserUpdate(updatedUser);
      }
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await changePassword(passwordForm);
      setSuccess('Password changed successfully!');
      setShowPasswordModal(false);
      setPasswordForm({ current_password: '', new_password: '' });
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="d-flex justify-content-center">
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <div className="user-settings">
      <h2 className="mb-4">User Settings</h2>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="row">
        <div className="col-md-8">
          {/* Profile Information Card */}
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">Profile Information</h5>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handleProfileSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <Form.Control
                    type="text"
                    value={user.username}
                    disabled
                    readOnly
                  />
                  <Form.Text className="text-muted">Username cannot be changed</Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Full Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={profileForm.full_name}
                    onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                    placeholder="Enter your full name"
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={profileForm.email}
                    onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                    placeholder="Enter your email"
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Role</Form.Label>
                  <Form.Control
                    type="text"
                    value={user.role.replace('_', ' ').toUpperCase()}
                    disabled
                    readOnly
                  />
                  <Form.Text className="text-muted">Role assigned by administrator</Form.Text>
                </Form.Group>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={loading}
                  className="me-2"
                >
                  {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Update Profile'}
                </Button>
              </Form>
            </Card.Body>
          </Card>

          {/* Security Card */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">Security</h5>
            </Card.Header>
            <Card.Body>
              <Button
                variant="outline-primary"
                onClick={() => setShowPasswordModal(true)}
              >
                Change Password
              </Button>
            </Card.Body>
          </Card>
        </div>

        <div className="col-md-4">
          {/* Account Info Card */}
          <Card>
            <Card.Header>
              <h5 className="mb-0">Account Information</h5>
            </Card.Header>
            <Card.Body>
              <div className="mb-3">
                <strong>Status:</strong>{' '}
                <span className={`badge ${user.is_active ? 'bg-success' : 'bg-danger'}`}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mb-3">
                <strong>Jobs Created:</strong> {user.job_count}
              </div>
              <div className="mb-3">
                <strong>Member Since:</strong>{' '}
                {new Date(user.created_at).toLocaleDateString()}
              </div>
              {user.last_login && (
                <div className="mb-3">
                  <strong>Last Login:</strong>{' '}
                  {new Date(user.last_login).toLocaleDateString()}
                </div>
              )}
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Password Change Modal */}
      <Modal show={showPasswordModal} onHide={() => setShowPasswordModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Change Password</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handlePasswordSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Current Password</Form.Label>
              <Form.Control
                type="password"
                value={passwordForm.current_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>New Password</Form.Label>
              <Form.Control
                type="password"
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                required
                minLength={6}
              />
              <Form.Text className="text-muted">
                Password must be at least 6 characters long
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Confirm New Password</Form.Label>
              <Form.Control
                type="password"
                required
                minLength={6}
                isInvalid={passwordForm.new_password && passwordForm.new_password.length < 6}
              />
              <Form.Control.Feedback type="invalid">
                Passwords must match and be at least 6 characters
              </Form.Control.Feedback>
            </Form.Group>

            <div className="d-flex justify-content-end">
              <Button
                variant="secondary"
                onClick={() => setShowPasswordModal(false)}
                className="me-2"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={loading || passwordForm.new_password.length < 6}
              >
                {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Change Password'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};