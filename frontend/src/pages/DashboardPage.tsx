import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api';
import { getCurrentUser, User } from '../api/user';
import { Navbar, Nav, Dropdown, Badge } from 'react-bootstrap';

interface Job {
    id: number;
    filename: string;
    status: string;
    created_at: string;
}

function UploadForm({ onUploadSuccess }: { onUploadSuccess: (job: Job) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setError('Please select a file to upload.');
            return;
        }
        setIsUploading(true);
        setError('');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await apiClient.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            onUploadSuccess(response.data as Job);
            setFile(null); // Reset file input
        } catch (err) {
            setError('File upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="card mb-4">
            <div className="card-header"><h5>Upload New Audio/Video File</h5></div>
            <div className="card-body">
                {error && <div className="alert alert-danger">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <input className="form-control" type="file" onChange={handleFileChange} />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={isUploading || !file}>
                        {isUploading ? 'Uploading...' : 'Upload and Process'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export function DashboardPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [error, setError] = useState('');
    const [isUploading, setIsUploading] = useState(false); // Track if any operation is happening
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const navigate = useNavigate();

    const fetchJobs = () => {
        apiClient.get('/jobs').then(response => {
            setJobs(response.data as Job[]);
        }).catch(err => {
            setError('Failed to fetch jobs.');
        });
    };

    const handleDeleteJob = async (jobId: number) => {
        if (!window.confirm('Are you sure you want to delete this job?')) {
            return;
        }
        
        setIsUploading(true); // Use the same state to prevent other actions during delete
        
        try {
            await apiClient.delete(`/jobs/${jobId}`);
            // Remove the deleted job from the UI
            setJobs(jobs.filter(job => job.id !== jobId));
            setError('');
        } catch (err) {
            setError('Failed to delete the job. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    useEffect(() => {
        fetchJobs();
        const interval = setInterval(fetchJobs, 5000); // Poll for status updates every 5 seconds
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const loadUser = async () => {
            try {
                const user = await getCurrentUser();
                setCurrentUser(user);
            } catch (error) {
                console.error('Failed to load user:', error);
            }
        };
        loadUser();
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('token');
        navigate('/login');
    };

    const handleUploadSuccess = (newJob: Job) => {
        setJobs([newJob, ...jobs]);
    };

    return (
        <>
            {/* Navigation Bar */}
            <Navbar bg="light" variant="light" expand="lg" className="mb-4 border-bottom shadow-sm">
                <div className="container">
                    <Navbar.Brand as={Link} to="/" className="text-primary fw-bold">
                        Meeting ASR
                    </Navbar.Brand>
                    <Navbar.Toggle aria-controls="basic-navbar-nav" />
                    <Navbar.Collapse id="basic-navbar-nav">
                        <Nav className="me-auto">
                            <Nav.Link as={Link} to="/">Dashboard</Nav.Link>
                        </Nav>
                        <Nav>
                            {currentUser && (
                                <>
                                    {(currentUser.role === 'admin' || currentUser.role === 'super_admin') && (
                                        <Nav.Link as={Link} to="/admin">
                                            <i className="bi bi-shield-lock me-1"></i>
                                            Admin
                                        </Nav.Link>
                                    )}
                                    <Dropdown align="end">
                                        <Dropdown.Toggle variant="outline-primary" id="user-dropdown">
                                            <i className="bi bi-person-circle me-1"></i>
                                            {currentUser.username}
                                        </Dropdown.Toggle>
                                        <Dropdown.Menu>
                                            <Dropdown.Header>
                                                <div className="d-flex align-items-center">
                                                    <div>
                                                        <div>{currentUser.full_name || currentUser.username}</div>
                                                        <small className="text-muted">
                                                            <Badge bg={
                                                                currentUser.role === 'super_admin' ? 'danger' :
                                                                currentUser.role === 'admin' ? 'warning' : 'primary'
                                                            } className="me-1">
                                                                {currentUser.role.replace('_', ' ').toUpperCase()}
                                                            </Badge>
                                                        </small>
                                                    </div>
                                                </div>
                                            </Dropdown.Header>
                                            <Dropdown.Divider />
                                            <Dropdown.Item as={Link} to="/settings">
                                                <i className="bi bi-gear me-2"></i>
                                                Settings
                                            </Dropdown.Item>
                                            <Dropdown.Divider />
                                            <Dropdown.Item onClick={handleLogout}>
                                                <i className="bi bi-box-arrow-right me-2"></i>
                                                Logout
                                            </Dropdown.Item>
                                        </Dropdown.Menu>
                                    </Dropdown>
                                </>
                            )}
                        </Nav>
                    </Navbar.Collapse>
                </div>
            </Navbar>

            <div className="container mt-4">
                <h1 className="mb-4">Dashboard</h1>
            
            <UploadForm onUploadSuccess={handleUploadSuccess} />

            <div className="card">
                <div className="card-header"><h5>My Jobs</h5></div>
                <div className="card-body">
                    {error && <div className="alert alert-danger">{error}</div>}
                    <table className="table table-hover">
                        <thead>
                            <tr>
                                <th>Filename</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(job => (
                                <tr key={job.id}>
                                    <td>{job.filename}</td>
                                    <td>
                                        <span className={`badge bg-${job.status === 'completed' ? 'success' : (job.status === 'failed' ? 'danger' : 'warning')}`}>
                                            {job.status}
                                        </span>
                                    </td>
                                    <td>{new Date(job.created_at).toLocaleString()}</td>
                                    <td>
                                        <Link to={`/jobs/${job.id}`} className={`btn btn-sm btn-info me-2 ${job.status !== 'completed' ? 'disabled' : ''}`}>
                                            View Result
                                        </Link>
                                        <button 
                                            className="btn btn-sm btn-danger"
                                            onClick={() => handleDeleteJob(job.id)}
                                            disabled={isUploading}
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            </div>
        </>
    );
}
