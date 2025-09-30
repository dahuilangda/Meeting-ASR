import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api';
import { TranscriptEditor } from '../components/TranscriptEditor';

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

    const [isSummarizing, setIsSummarizing] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [targetLanguage, setTargetLanguage] = useState("Chinese");
    const [translatedText, setTranslatedText] = useState('');

    useEffect(() => {
        if (jobId) {
            apiClient.get(`/jobs/${jobId}`).then(response => {
                setJob(response.data);
            }).catch(err => {
                setError('Failed to fetch job details.');
            });
        }
    }, [jobId]);

    const handleSummarize = async () => {
        if (!jobId) return;
        setIsSummarizing(true);
        try {
            const response = await apiClient.post(`/jobs/${jobId}/summarize`);
            setJob(response.data); // Update job with summary
        } catch (err) {
            console.error("Summarization failed", err);
        } finally {
            setIsSummarizing(false);
        }
    };

    const handleTranslate = async () => {
        if (!jobId) return;
        setIsTranslating(true);
        try {
            const response = await apiClient.post(`/jobs/${jobId}/translate`, { target_language: targetLanguage });
            setTranslatedText(response.data.translated_text);
        } catch (err) {
            console.error("Translation failed", err);
        } finally {
            setIsTranslating(false);
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
                    <hr />
                    <h5 className="card-title">Transcript</h5>
                    
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
                    
                    <hr />
                    <div className="d-flex align-items-center gap-2 mb-3">
                        <button className="btn btn-info" onClick={handleSummarize} disabled={isSummarizing}>
                            {isSummarizing ? 'Summarizing...' : 'Generate Summary'}
                        </button>
                        <button className="btn btn-success" onClick={handleTranslate} disabled={isTranslating}>
                            {isTranslating ? 'Translating...' : 'Translate'}
                        </button>
                        <select className="form-select w-auto" value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)}>
                            <option value="Chinese">Chinese</option>
                            <option value="English">English</option>
                            <option value="Japanese">Japanese</option>
                            <option value="French">French</option>
                        </select>
                    </div>

                    {job.summary && (
                        <div className="mb-3">
                            <h5 className="card-title">Summary</h5>
                            <div className="p-3 bg-light rounded" style={{ whiteSpace: 'pre-wrap' }}>{job.summary}</div>
                        </div>
                    )}

                    {translatedText && (
                        <div>
                            <h5 className="card-title">Translation</h5>
                            <div className="p-3 bg-light rounded" style={{ whiteSpace: 'pre-wrap' }}>{translatedText}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}