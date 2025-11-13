import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient, oauthLogin } from '../api';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';

export function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            setIsSubmitting(true);
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const response = await apiClient.post('/token', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
            
            localStorage.setItem('token', (response.data as { access_token: string }).access_token);
            window.location.href = '/'; // Force reload to re-evaluate auth status
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Login failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
        setError('');
        if (!googleClientId) {
            setError('Google login is not available at this time.');
            return;
        }
        if (!credentialResponse.credential) {
            setError('Google login failed, please try again.');
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await oauthLogin({ provider: 'google', id_token: credentialResponse.credential });
            localStorage.setItem('token', response.access_token);
            window.location.href = '/';
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Google login failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleLoginError = () => {
        setError('Google login failed, please try again.');
    };

    return (
        <div className="container mt-5">
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <div className="card">
                        <div className="card-body">
                            <h3 className="card-title text-center">Login</h3>
                            {error && <div className="alert alert-danger">{error}</div>}
                            <form onSubmit={handleSubmit}>
                                <div className="mb-3">
                                    <label htmlFor="username">Username</label>
                                    <input
                                        type="text"
                                        id="username"
                                        className="form-control"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="Enter your username"
                                        required
                                    />
                                </div>
                                <div className="mb-3">
                                    <label htmlFor="password">Password</label>
                                    <input
                                        type="password"
                                        id="password"
                                        className="form-control"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter your password"
                                        required
                                    />
                                </div>
                                <div className="d-grid">
                                    <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                                        {isSubmitting ? 'Signing in...' : 'Login'}
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
                            <small>Don't have an account? <Link to="/register">Register here</Link></small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
