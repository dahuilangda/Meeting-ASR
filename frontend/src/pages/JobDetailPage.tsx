import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { MarkdownViewer } from '../components/MarkdownViewer';
import MarkdownEditor from '@uiw/react-markdown-editor';

interface JobDetails {
    id: number;
    filename: string;
    status: string;
    created_at: string;
    transcript: string | null;
    timing_info: string | null;
    summary: string | null;
}

export function JobDetailPage() {
    const { jobId } = useParams<{ jobId: string }>();
    const [job, setJob] = useState<JobDetails | null>(null);
    const [error, setError] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('Chinese');
    const [isEditingSummary, setIsEditingSummary] = useState(false);
    const [editedSummary, setEditedSummary] = useState('');
    
    // Initialize activeTab from URL hash or default to 'transcript'
    const getInitialTab = () => {
        const hash = window.location.hash;
        if (hash === '#summary') return 'summary';
        return 'transcript'; // default
    };
    
    const [activeTab, setActiveTab] = useState(getInitialTab);
    
    const [isSummarizing, setIsSummarizing] = useState(false);
    
    useEffect(() => {
        if (jobId) {
            apiClient.get(`/jobs/${jobId}`).then(response => {
                setJob(response.data as JobDetails);
            }).catch(err => {
                setError('Failed to fetch job details.');
            });
        }
    }, [jobId]);

    // Update URL hash when activeTab changes
    useEffect(() => {
        window.location.hash = activeTab;
    }, [activeTab]);

    const handleSummarize = async () => {
        if (!jobId) return;
        setActiveTab('summary'); // Switch to summary tab immediately
        setIsSummarizing(true);
        try {
            const response = await apiClient.post(`/jobs/${jobId}/summarize`, {
                target_language: targetLanguage
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            const jobData = response.data as JobDetails;
            setJob(jobData); // Update job with summary
            // Also update the edited summary state
            if (jobData.summary) {
                setEditedSummary(jobData.summary);
            }
        } catch (err: unknown) {
            console.error("Summarization failed", err);
            let errorMessage = 'Unknown error';
            if (err instanceof Error) {
                errorMessage = err.message;
            } else if (typeof err === 'object' && err !== null && 'response' in err) {
                const errorWithResponse = err as { response?: { data?: { detail?: string } } };
                errorMessage = errorWithResponse.response?.data?.detail || 'Unknown error';
            }
            alert(`Failed to generate summary: ${errorMessage}`);
        } finally {
            setIsSummarizing(false);
        }
    };

    const handleSaveSummary = async () => {
        if (!jobId || !editedSummary) return;

        try {
            // Update the job's summary in the backend
            const response = await apiClient.post(`/jobs/${jobId}/update_summary`, {
                summary: editedSummary
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            setJob(response.data as JobDetails);
            setIsEditingSummary(false);
        } catch (err: unknown) {
            console.error("Failed to save summary", err);
            let errorMessage = 'Unknown error';
            if (err instanceof Error) {
                errorMessage = err.message;
            } else if (typeof err === 'object' && err !== null && 'response' in err) {
                const errorWithResponse = err as { response?: { data?: { detail?: string } } };
                errorMessage = errorWithResponse.response?.data?.detail || 'Unknown error';
            }
            alert(`Failed to save summary: ${errorMessage}`);
        }
    };

    if (error) {
        return <div className="container mt-5 alert alert-danger">{error}</div>;
    }

    if (!job) {
        return <div className="container mt-5">Loading...</div>;
    }

    return (
        <div className="container mt-5">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>Job Details</h2>
                <div className="d-flex gap-2">
                    <button className="btn btn-outline-secondary" onClick={() => { 
                        localStorage.removeItem('token'); 
                        window.location.href = '/login'; 
                    }}>
                        Logout
                    </button>
                    <Link to="/" className="btn btn-secondary">Back to Dashboard</Link>
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h5>{job.filename}</h5></div>
                <div className="card-body">
                    <p><strong>Status:</strong> {job.status}</p>
                    <p><strong>Date:</strong> {new Date(job.created_at).toLocaleString()}</p>
                    {/* Tab Navigation and Actions */}
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <ul className="nav nav-tabs">
                            <li className="nav-item">
                                <button 
                                    className={`nav-link ${activeTab === 'transcript' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('transcript')}
                                >
                                    Transcript
                                </button>
                            </li>
                            <li className="nav-item">
                                <button 
                                    className={`nav-link ${activeTab === 'summary' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('summary')}
                                >
                                    Meeting Summary
                                </button>
                            </li>
                        </ul>
                        <div className="d-flex gap-2">
                            <select 
                                className="form-select form-select-sm" 
                                value={targetLanguage} 
                                onChange={e => setTargetLanguage(e.target.value)}
                                disabled={isSummarizing}
                            >
                                <option value="Chinese">Chinese</option>
                                <option value="English">English</option>
                                <option value="Japanese">Japanese</option>
                                <option value="French">French</option>
                                <option value="Spanish">Spanish</option>
                                <option value="German">German</option>
                                <option value="Korean">Korean</option>
                            </select>
                            <button 
                                className="btn btn-outline-primary btn-sm"
                                onClick={handleSummarize}
                                disabled={isSummarizing}
                            >
                                {isSummarizing ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-journal-text me-1"></i> Generate Summary
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    
                    {/* Tab Content */}
                    <div className="tab-content">
                        <div className={`tab-pane fade ${activeTab === 'transcript' ? 'show active' : ''}`}>
                            <div className="d-flex justify-content-between align-items-center">
                                <h5 className="card-title">Transcript</h5>
                                {isSummarizing && (
                                    <small className="text-muted">
                                        <span className="me-2">
                                            <span className="spinner-border spinner-border-sm me-1" role="status"></span> 
                                            Generating summary in background...
                                        </span>
                                    </small>
                                )}
                            </div>
                            
                            {job.transcript ? (
                                <TranscriptEditor 
                                    jobId={job.id} 
                                    initialTranscript={job.transcript} 
                                    onTranscriptUpdate={(updatedTranscript) => {
                                        // Update the job state with the new transcript
                                        setJob({...job, transcript: updatedTranscript});
                                    }} 
                                />
                            ) : (
                                <div className="alert alert-info">Processing transcript...</div>
                            )}
                        </div>
                        
                        <div className={`tab-pane fade ${activeTab === 'summary' ? 'show active' : ''}`}>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h5 className="card-title">Meeting Summary</h5>
                                {job?.summary && !isEditingSummary && (
                                    <button 
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => {
                                            setEditedSummary(job.summary || '');
                                            setIsEditingSummary(true);
                                        }}
                                    >
                                        <i className="bi bi-pencil me-1"></i> Edit Summary
                                    </button>
                                )}
                                {isEditingSummary && (
                                    <div className="d-flex gap-2">
                                        <button 
                                            className="btn btn-success btn-sm"
                                            onClick={handleSaveSummary}
                                        >
                                            <i className="bi bi-save me-1"></i> Save
                                        </button>
                                        <button 
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setIsEditingSummary(false)}
                                        >
                                            <i className="bi bi-x me-1"></i> Cancel
                                        </button>
                                    </div>
                                )}
                            </div>
                            
                            {job.summary ? (
                                isEditingSummary ? (
                                    <div style={{ height: '500px' }}>
                                        <MarkdownEditor
                                            value={editedSummary}
                                            onChange={(value) => setEditedSummary(value)}
                                            className="w-100"
                                            style={{ height: '100%' }}
                                        />
                                    </div>
                                ) : (
                                    <div className="border rounded p-3 bg-light" style={{ minHeight: '300px' }}>
                                        <MarkdownViewer content={job.summary} />
                                    </div>
                                )
                            ) : isSummarizing ? (
                                <div className="alert alert-info d-flex align-items-center">
                                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                    Generating meeting summary... You can switch tabs, generation will continue in the background.
                                </div>
                            ) : (
                                <div className="alert alert-info">No summary generated yet. Click the Generate Summary button to create one.</div>
                            )}
                        </div>
                        
                    </div>
                </div>
            </div>
        </div>
    );
}