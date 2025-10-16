import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api';
import { getCurrentUser, User } from '../api/user';
import { Navbar, Nav, Dropdown, Badge, Alert, ProgressBar } from 'react-bootstrap';
import { JobWebSocketClient, WebSocketMessage } from '../websocket';

interface Job {
    id: number;
    filename: string;
    status: string;
    created_at: string;
    progress?: number;
    error_message?: string;
    processing_time?: number;
    file_size?: number;
}

interface QueueStatus {
    active_jobs: number;
    queued_jobs: number;
    total_queue_size: number;
    jobs: Array<{
        job_id: number;
        status: string;
        progress: number;
        error_message?: string;
        queue_position?: number;
    }>;
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
        } catch (err: any) {
            if (err.response?.status === 429) {
                setError('Too many concurrent jobs. Please wait for current jobs to complete.');
            } else if (err.response?.status === 413) {
                setError('File too large. Maximum size is 200MB.');
            } else if (err.response?.status === 503) {
                setError('Job queue is full. Please try again later.');
            } else {
                setError(err.response?.data?.detail || 'File upload failed. Please try again.');
            }
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
    const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
    const [wsNotification, setWsNotification] = useState<string>('');
    const [isUploading, setIsUploading] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [wsClient, setWsClient] = useState<JobWebSocketClient | null>(null);
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

    const handleCancelJob = async (jobId: number) => {
        try {
            await apiClient.post(`/jobs/${jobId}/cancel`);
            setJobs(jobs.filter(job => job.id !== jobId));
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to cancel the job. Please try again.');
        }
    };

    useEffect(() => {
        fetchJobs();
        const interval = setInterval(fetchJobs, 10000); // Reduced polling frequency since we have WebSocket
        return () => clearInterval(interval);
    }, []);

    // Initialize WebSocket connection
    useEffect(() => {
        if (currentUser) {
            try {
                const client = JobWebSocketClient.fromLocalStorage();

                client.onMessage((message: WebSocketMessage) => {
                    console.log('WebSocket message:', message);

                    // Show notification
                    if (message.message) {
                        setWsNotification(message.message);
                        setTimeout(() => setWsNotification(''), 5000);
                    }

                    // Update jobs list
                    if (message.job_id) {
                        fetchJobs();
                    }
                });

                client.onStatusChange((jobId: number, status: string, progress: number) => {
                    // Update specific job in the list
                    setJobs(prevJobs =>
                        prevJobs.map(job =>
                            job.id === jobId
                                ? { ...job, status, progress: progress || 0 }
                                : job
                        )
                    );
                });

                client.onError((error: string) => {
                    setError(error);
                });

                client.connect().then(() => {
                    setWsClient(client);
                    console.log('WebSocket connected successfully');
                }).catch(error => {
                    console.error('Failed to connect WebSocket:', error);
                });

                // Fetch queue status
                apiClient.get('/queue/status').then(response => {
                    setQueueStatus(response.data as QueueStatus);
                }).catch(err => {
                    console.error('Failed to fetch queue status:', err);
                });

                return () => {
                    client.disconnect();
                };
            } catch (error) {
                console.error('Failed to create WebSocket client:', error);
            }
        }
    }, [currentUser]);

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

                {/* WebSocket Notifications */}
                {wsNotification && (
                    <Alert variant="success" className="mb-3" dismissible onClose={() => setWsNotification('')}>
                        {wsNotification}
                    </Alert>
                )}

                <UploadForm onUploadSuccess={handleUploadSuccess} />

                {/* Queue Status Display */}
                {queueStatus && (queueStatus.active_jobs > 0 || queueStatus.queued_jobs > 0) && (
                    <div className="card mb-4">
                        <div className="card-header">
                            <h6 className="mb-0">
                                <i className="bi bi-clock me-2"></i>
                                Queue Status
                                {wsClient && (
                                    <Badge bg="success" className="ms-2">Live</Badge>
                                )}
                            </h6>
                        </div>
                        <div className="card-body py-2">
                            <div className="row">
                                <div className="col-md-4">
                                    <small className="text-muted">Active Jobs</small>
                                    <div className="fw-bold">{queueStatus.active_jobs}</div>
                                </div>
                                <div className="col-md-4">
                                    <small className="text-muted">Queued Jobs</small>
                                    <div className="fw-bold">{queueStatus.queued_jobs}</div>
                                </div>
                                <div className="col-md-4">
                                    <small className="text-muted">Total in Queue</small>
                                    <div className="fw-bold">{queueStatus.total_queue_size}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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
                                        <div className="d-flex align-items-center">
                                            <span className={`badge bg-${job.status === 'completed' ? 'success' : (job.status === 'failed' ? 'danger' : (job.status === 'processing' ? 'primary' : 'warning'))} me-2`}>
                                                {job.status === 'queued' ? 'Queued' : job.status === 'processing' ? 'Processing' : job.status === 'completed' ? 'Completed' : job.status === 'failed' ? 'Failed' : job.status}
                                            </span>
                                            {job.status === 'processing' && job.progress !== undefined && (
                                                <small className="text-muted">{Math.round(job.progress)}%</small>
                                            )}
                                        </div>
                                        {job.status === 'processing' && job.progress !== undefined && (
                                            <ProgressBar now={job.progress} className="mt-1" style={{ height: '4px' }} />
                                        )}
                                        {job.error_message && (
                                            <small className="text-danger d-block mt-1">{job.error_message}</small>
                                        )}
                                    </td>
                                    <td>{new Date(job.created_at).toLocaleString()}</td>
                                    <td>
                                        <Link to={`/jobs/${job.id}`} className={`btn btn-sm btn-info me-2 ${job.status !== 'completed' ? 'disabled' : ''}`}>
                                            View Result
                                        </Link>
                                        {job.status === 'queued' && (
                                            <button
                                                className="btn btn-sm btn-warning me-2"
                                                onClick={() => handleCancelJob(job.id)}
                                                disabled={isUploading}
                                            >
                                                Cancel
                                            </button>
                                        )}
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
