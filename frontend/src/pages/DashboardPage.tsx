import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Navbar, Nav, Dropdown, Badge, Alert, ProgressBar } from 'react-bootstrap';
import { apiClient, renameJob } from '../api';
import { getCurrentUser, User } from '../api/user';
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
    jobs?: Array<{
        job_id: number;
        status: string;
        progress: number;
        error_message?: string;
    }>;
}

interface JobListResponse {
    items: Job[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

function UploadForm({ onUploadSuccess }: { onUploadSuccess: (job: Job) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            setFile(event.target.files[0]);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
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
            setFile(null);
        } catch (err: any) {
            if (err.response?.status === 429) {
                setError('Too many concurrent jobs. Please wait for current jobs to finish.');
            } else if (err.response?.status === 413) {
                setError('File too large. Maximum upload size is 200MB.');
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
            <div className="card-header">
                <h5 className="mb-0">Upload New Audio/Video File</h5>
            </div>
            <div className="card-body">
                {error && <div className="alert alert-danger">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="mb-3">
                        <input className="form-control" type="file" onChange={handleFileChange} />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={isUploading || !file}>
                        {isUploading ? 'Uploading…' : 'Upload and Process'}
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
    const [wsNotification, setWsNotification] = useState('');
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [wsClient, setWsClient] = useState<JobWebSocketClient | null>(null);
    const [renamingJobId, setRenamingJobId] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);
    const [isJobMutating, setIsJobMutating] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [totalJobs, setTotalJobs] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoadingJobs, setIsLoadingJobs] = useState(true);
    const paginationStateRef = useRef<{ page: number; pageSize: number; search: string }>({
        page: 1,
        pageSize: 10,
        search: '',
    });
    const navigate = useNavigate();

    const fetchJobs = useCallback(
        async (page: number, size: number, searchValue: string, options?: { suppressLoader?: boolean }) => {
            if (!options?.suppressLoader) {
                setIsLoadingJobs(true);
            }
            try {
                const response = await apiClient.get<JobListResponse>('/jobs', {
                    params: {
                        page,
                        page_size: size,
                        search: searchValue || undefined,
                    },
                });

                const data = response.data;
                const resolvedPageSize = data.page_size || size;
                const resolvedTotal = data.total || 0;
                const resolvedPage = data.page || page;
                const resolvedTotalPages = data.total_pages
                    ? Math.max(1, data.total_pages)
                    : Math.max(1, Math.ceil(resolvedTotal / resolvedPageSize));

                setJobs(data.items);
                setTotalJobs(resolvedTotal);
                setTotalPages(resolvedTotalPages);
                setPageSize(resolvedPageSize);
                setError('');

                if (data.items.length === 0 && resolvedTotal > 0 && resolvedPage > 1) {
                    setCurrentPage(resolvedPage - 1);
                    return;
                }

                setCurrentPage(resolvedPage);
            } catch (err: any) {
                setError(err.response?.data?.detail || 'Failed to fetch jobs.');
            } finally {
                if (!options?.suppressLoader) {
                    setIsLoadingJobs(false);
                }
            }
        },
        []
    );

    const refreshJobs = useCallback(async () => {
        const { page, pageSize: size, search } = paginationStateRef.current;
        await fetchJobs(page, size, search, { suppressLoader: true });
    }, [fetchJobs]);

    const fetchQueueStatus = useCallback(async () => {
        try {
            const response = await apiClient.get<QueueStatus>('/queue/status');
            setQueueStatus(response.data);
        } catch (err) {
            console.error('Failed to fetch queue status:', err);
        }
    }, []);

    useEffect(() => {
        paginationStateRef.current = { page: currentPage, pageSize, search: debouncedSearch };
    }, [currentPage, pageSize, debouncedSearch]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
        return () => window.clearTimeout(timeoutId);
    }, [searchTerm]);

    useEffect(() => {
        void fetchJobs(currentPage, pageSize, debouncedSearch);
    }, [currentPage, pageSize, debouncedSearch, fetchJobs]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            const { page, pageSize: size, search } = paginationStateRef.current;
            void fetchJobs(page, size, search, { suppressLoader: true });
        }, 10000);
        return () => window.clearInterval(intervalId);
    }, [fetchJobs]);

    useEffect(() => {
        void fetchQueueStatus();
        const intervalId = window.setInterval(() => {
            void fetchQueueStatus();
        }, 10000);
        return () => window.clearInterval(intervalId);
    }, [fetchQueueStatus]);

    useEffect(() => {
        const loadUser = async () => {
            try {
                const user = await getCurrentUser();
                setCurrentUser(user);
            } catch (err) {
                console.error('Failed to load current user:', err);
            }
        };
        void loadUser();
    }, []);

    useEffect(() => {
        if (!currentUser) {
            return;
        }
        try {
            const client = JobWebSocketClient.fromLocalStorage();
            client.onMessage((message: WebSocketMessage) => {
                if (message.message) {
                    setWsNotification(message.message);
                    setTimeout(() => setWsNotification(''), 5000);
                }
                if (message.job_id) {
                    void refreshJobs();
                    void fetchQueueStatus();
                }
            });
            client.onStatusChange((jobId: number, status: string, progress: number) => {
                setJobs(prevJobs =>
                    prevJobs.map(job =>
                        job.id === jobId ? { ...job, status, progress: progress || 0 } : job
                    )
                );
            });
            client.onError(err => {
                if (typeof err === 'string') {
                    setError(err);
                } else {
                    setError('WebSocket connection error.');
                }
            });
            client.connect().then(() => setWsClient(client)).catch(err => {
                console.error('WebSocket connection failed:', err);
            });
            return () => client.disconnect();
        } catch (err) {
            console.error('Failed to create WebSocket client:', err);
        }
    }, [currentUser, refreshJobs, fetchQueueStatus]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        navigate('/login');
    };

    const prepareForDataReload = useCallback(() => {
        setJobs([]);
        setIsLoadingJobs(true);
        setRenamingJobId(null);
        setRenameValue('');
    }, []);

    const handleUploadSuccess = (_newJob: Job) => {
        const { pageSize: size, search } = paginationStateRef.current;
        prepareForDataReload();
        if (currentPage !== 1) {
            setCurrentPage(1);
        } else {
            void fetchJobs(1, size, search);
        }
        void fetchQueueStatus();
    };

    const handleDeleteJob = async (jobId: number) => {
        if (!window.confirm('Are you sure you want to delete this job?')) {
            return;
        }
        setIsJobMutating(true);
        try {
            await apiClient.delete(`/jobs/${jobId}`);
            setJobs(prev => prev.filter(job => job.id !== jobId));
            await refreshJobs();
            setError('');
            await fetchQueueStatus();
        } catch (err) {
            setError('Failed to delete the job. Please try again.');
            try {
                await refreshJobs();
            } catch (refreshErr) {
                console.error('Failed to refresh jobs after delete error:', refreshErr);
            }
        } finally {
            setIsJobMutating(false);
        }
    };

    const handleCancelJob = async (jobId: number) => {
        setIsJobMutating(true);
        try {
            await apiClient.post(`/jobs/${jobId}/cancel`);
            setJobs(prev => prev.filter(job => job.id !== jobId));
            await refreshJobs();
            await fetchQueueStatus();
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to cancel the job. Please try again.');
            try {
                await refreshJobs();
            } catch (refreshErr) {
                console.error('Failed to refresh jobs after cancel error:', refreshErr);
            }
        } finally {
            setIsJobMutating(false);
        }
    };

    const handleStartRename = (job: Job) => {
        setRenamingJobId(job.id);
        setRenameValue(job.filename);
        setError('');
    };

    const handleCancelRename = () => {
        setRenamingJobId(null);
        setRenameValue('');
    };

    const handleSaveRename = async () => {
        if (renamingJobId === null) {
            return;
        }
        const trimmedName = renameValue.trim();
        if (!trimmedName) {
            setError('Filename cannot be empty.');
            return;
        }
        setIsRenaming(true);
        try {
            const updatedJob = await renameJob(renamingJobId, trimmedName);
            setJobs(prevJobs =>
                prevJobs.map(job =>
                    job.id === renamingJobId ? { ...job, filename: updatedJob.filename } : job
                )
            );
            setRenamingJobId(null);
            setRenameValue('');
            setError('');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to rename job. Please try again.');
        } finally {
            setIsRenaming(false);
        }
    };

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        if (value === searchTerm) {
            return;
        }
        setSearchTerm(value);
        if (currentPage !== 1) {
            setCurrentPage(1);
        }
        prepareForDataReload();
    };

    const handlePageChange = (nextPage: number) => {
        if (nextPage < 1 || nextPage > totalPages || nextPage === currentPage) {
            return;
        }
        setCurrentPage(nextPage);
        prepareForDataReload();
    };

    const handlePageSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedSize = Number(event.target.value);
        if (!Number.isFinite(selectedSize) || selectedSize <= 0) {
            return;
        }
        prepareForDataReload();
        setPageSize(selectedSize);
        if (currentPage !== 1) {
            setCurrentPage(1);
        }
    };

    const isSearchActive = debouncedSearch.length > 0;
    const hasJobsOnPage = jobs.length > 0;
    const startIndex = hasJobsOnPage ? (currentPage - 1) * pageSize + 1 : 0;
    const endIndex = hasJobsOnPage ? startIndex + jobs.length - 1 : 0;
    const basePageSizeOptions = [5, 10, 20, 50];
    const pageSizeOptions = basePageSizeOptions.includes(pageSize)
        ? basePageSizeOptions
        : [...basePageSizeOptions, pageSize].sort((a, b) => a - b);
    const noJobsMessage = isSearchActive ? 'No jobs match your search.' : 'No jobs available yet.';
    const showEmptyState = !isLoadingJobs && jobs.length === 0;
    const displayedPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 0;

    return (
        <>
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
                                                            <Badge
                                                                bg={
                                                                    currentUser.role === 'super_admin'
                                                                        ? 'danger'
                                                                        : currentUser.role === 'admin'
                                                                            ? 'warning'
                                                                            : 'primary'
                                                                }
                                                                className="me-1"
                                                            >
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

                {wsNotification && (
                    <Alert variant="success" className="mb-3" dismissible onClose={() => setWsNotification('')}>
                        {wsNotification}
                    </Alert>
                )}

                <UploadForm onUploadSuccess={handleUploadSuccess} />

                {queueStatus && (queueStatus.active_jobs > 0 || queueStatus.queued_jobs > 0) && (
                    <div className="card mb-4">
                        <div className="card-header">
                            <h6 className="mb-0">
                                <i className="bi bi-clock me-2"></i>
                                Queue Status
                                {wsClient && <Badge bg="success" className="ms-2">Live</Badge>}
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
                    <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                        <h5 className="mb-0">My Jobs</h5>
                        <div className="input-group input-group-sm" style={{ maxWidth: '320px' }}>
                            <span className="input-group-text" id="jobs-search-addon">
                                <i className="bi bi-search"></i>
                            </span>
                            <input
                                type="search"
                                className="form-control"
                                placeholder="Search jobs..."
                                aria-label="Search jobs"
                                aria-describedby="jobs-search-addon"
                                value={searchTerm}
                                onChange={handleSearchChange}
                            />
                        </div>
                    </div>
                    <div className="card-body">
                        {error && <div className="alert alert-danger">{error}</div>}
                        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                            <div>
                                <small className="text-muted">
                                    Showing {startIndex}-{endIndex} of {totalJobs}
                                    {isSearchActive ? ' matching jobs' : ' jobs'}
                                    <span className="ms-2">Page {displayedPage} of {totalPages}</span>
                                    {isLoadingJobs && (
                                        <span className="ms-2 text-muted">
                                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                            Updating
                                        </span>
                                    )}
                                </small>
                            </div>
                            <div className="d-flex align-items-center gap-3 flex-wrap">
                                <div className="d-flex align-items-center gap-2">
                                    <small className="text-muted">Rows per page</small>
                                    <select
                                        className="form-select form-select-sm"
                                        style={{ width: '90px' }}
                                        value={pageSize}
                                        onChange={handlePageSizeChange}
                                        aria-label="Select rows per page"
                                    >
                                        {pageSizeOptions.map(option => (
                                            <option key={option} value={option}>{option}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="btn-group" role="group" aria-label="Pagination controls">
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => handlePageChange(1)}
                                        disabled={currentPage === 1 || isLoadingJobs}
                                        title="First page"
                                    >
                                        <i className="bi bi-chevron-double-left"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1 || isLoadingJobs}
                                        title="Previous page"
                                    >
                                        <i className="bi bi-chevron-left"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages || isLoadingJobs}
                                        title="Next page"
                                    >
                                        <i className="bi bi-chevron-right"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => handlePageChange(totalPages)}
                                        disabled={currentPage === totalPages || isLoadingJobs}
                                        title="Last page"
                                    >
                                        <i className="bi bi-chevron-double-right"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

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
                                {isLoadingJobs && jobs.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="text-center text-muted py-4">
                                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                            Loading jobs…
                                        </td>
                                    </tr>
                                ) : showEmptyState ? (
                                    <tr>
                                        <td colSpan={4} className="text-center text-muted py-4">{noJobsMessage}</td>
                                    </tr>
                                ) : (
                                    jobs.map(job => {
                                        const badgeVariant =
                                            job.status === 'completed'
                                                ? 'success'
                                                : job.status === 'failed'
                                                    ? 'danger'
                                                    : job.status === 'processing'
                                                        ? 'primary'
                                                        : 'warning';
                                        const statusLabel =
                                            job.status === 'queued'
                                                ? 'Queued'
                                                : job.status === 'processing'
                                                    ? 'Processing'
                                                    : job.status === 'completed'
                                                        ? 'Completed'
                                                        : job.status === 'failed'
                                                            ? 'Failed'
                                                            : job.status;

                                        return (
                                            <tr key={job.id}>
                                                <td style={{ maxWidth: '260px' }}>
                                                    {renamingJobId === job.id ? (
                                                        <div className="d-flex align-items-center gap-2">
                                                            <input
                                                                className="form-control form-control-sm"
                                                                value={renameValue}
                                                                onChange={event => setRenameValue(event.target.value)}
                                                                onKeyDown={event => {
                                                                    if (event.key === 'Enter') {
                                                                        event.preventDefault();
                                                                        void handleSaveRename();
                                                                    } else if (event.key === 'Escape') {
                                                                        event.preventDefault();
                                                                        handleCancelRename();
                                                                    }
                                                                }}
                                                                disabled={isRenaming}
                                                                autoFocus
                                                            />
                                                            <button
                                                                type="button"
                                                                className="btn btn-sm btn-primary"
                                                                onClick={() => void handleSaveRename()}
                                                                disabled={isRenaming || !renameValue.trim()}
                                                                title="Save filename"
                                                            >
                                                                <i className="bi bi-check-lg"></i>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-sm btn-outline-secondary"
                                                                onClick={handleCancelRename}
                                                                disabled={isRenaming}
                                                                title="Cancel"
                                                            >
                                                                <i className="bi bi-x-lg"></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="d-flex align-items-center justify-content-between gap-2">
                                                            <span className="text-truncate" style={{ maxWidth: '180px' }} title={job.filename}>
                                                                {job.filename}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="btn btn-link btn-sm p-0 text-secondary"
                                                                onClick={() => handleStartRename(job)}
                                                                disabled={isRenaming}
                                                                title="Rename file"
                                                            >
                                                                <i className="bi bi-pencil-square"></i>
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="d-flex align-items-center">
                                                        <span className={`badge bg-${badgeVariant} me-2`}>
                                                            {statusLabel}
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
                                                    <Link
                                                        to={`/jobs/${job.id}`}
                                                        className={`btn btn-sm btn-info me-2${job.status !== 'completed' ? ' disabled' : ''}`}
                                                        aria-disabled={job.status !== 'completed'}
                                                    >
                                                        View Result
                                                    </Link>
                                                    {job.status === 'queued' && (
                                                        <button
                                                            className="btn btn-sm btn-warning me-2"
                                                            onClick={() => handleCancelJob(job.id)}
                                                            disabled={isJobMutating}
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => handleDeleteJob(job.id)}
                                                        disabled={isJobMutating}
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </>
    );
}

export default DashboardPage;
