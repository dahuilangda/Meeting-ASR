import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, oauthLogin } from '../api';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';

export function RegisterPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        try {
            setIsSubmitting(true);
            await apiClient.post('/register', { username, password, confirm_password: confirmPassword });
            navigate('/login');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Registration failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
        setError('');
        if (!googleClientId) {
            setError('Google sign-in is not available at this time.');
            return;
        }
        if (!credentialResponse.credential) {
            setError('Google sign-in failed, please try again.');
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await oauthLogin({ provider: 'google', id_token: credentialResponse.credential });
            localStorage.setItem('token', response.access_token);
            window.location.href = '/';
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Google sign-in failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleLoginError = () => {
        setError('Google sign-in failed, please try again.');
    };

    return (
        <div className="container mt-5">
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <div className="card">
                        <div className="card-body">
                            <h3 className="card-title text-center">Register</h3>
                            {error && <div className="alert alert-danger">{error}</div>}
                            <form onSubmit={handleSubmit}>
                                <div className="mb-3">
                                    <label>Username</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="mb-3">
                                    <label>Password</label>
                                    <input
                                        type="password"
                                        className="form-control"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="mb-3">
                                    <label>Confirm Password</label>
                                    <input
                                        type="password"
                                        className="form-control"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="d-grid">
                                    <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                                        {isSubmitting ? 'Submitting...' : 'Register'}
                                    </button>
                                </div>
                            </form>
                            {googleClientId && (
                                <>
                                    <div className="text-center mt-3">
                                        <small className="text-muted">OR</small>
                                    </div>
                                    <div className="d-flex justify-content-center mt-3">
                                        <GoogleLogin onSuccess={handleGoogleLogin} onError={handleGoogleLoginError} ux_mode="popup" />
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="card-footer text-center">
                            <small>Already have an account? <Link to="/login">Login here</Link></small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
