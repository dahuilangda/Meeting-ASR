import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api';

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

    const handleUploadSuccess = (newJob: Job) => {
        setJobs([newJob, ...jobs]);
    };

    return (
        <div className="container mt-5">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1>Dashboard</h1>
                <button className="btn btn-secondary" onClick={() => { localStorage.removeItem('token'); window.location.href = '/login'; }}>Logout</button>
            </div>
            
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
    );
}
