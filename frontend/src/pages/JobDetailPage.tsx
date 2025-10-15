import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { SummaryWithReferences } from '../components/SummaryWithReferences';
import { AssistantChat } from '../components/AssistantChat';

interface JobDetails {
    id: number;
    filename: string;
    status: string;
    created_at: string;
    transcript: string | null;
    timing_info: string | null;
    summary: string | null;
}

interface TranscriptSegment {
    index: number;
    speaker: string;
    text: string;
    start_time: number;
    end_time: number;
}

export function JobDetailPage() {
    const { jobId } = useParams<{ jobId: string }>();
    const [job, setJob] = useState<JobDetails | null>(null);
    const [error, setError] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('Chinese');
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
    const [highlightedSegments, setHighlightedSegments] = useState<number[]>([]);
    
    // Initialize activeTab from URL hash or default to 'transcript'
    const getInitialTab = () => {
        const hash = window.location.hash;
        if (hash === '#summary') return 'summary';
        return 'transcript'; // default
    };
    
    const [activeTab, setActiveTab] = useState(getInitialTab);
    
    const [isSummarizing, setIsSummarizing] = useState(false);

    const handleSegmentReference = (segmentIndices: number | number[]) => {
        const indices = Array.isArray(segmentIndices) ? segmentIndices : [segmentIndices];
        console.log('handleSegmentReference called with:', indices); // Debug log

        // Set highlighted segments - these are 1-based indices from transcript
        setHighlightedSegments(indices);

        // Scroll to the first referenced segment after a short delay
        setTimeout(() => {
            const segmentElements = document.querySelectorAll('.transcript-segment');
            // Find the segment that contains the referenced transcript segment
            let targetElement: Element | null = null;

            // Look for each highlighted index to find the corresponding segment element
            for (const refIndex of indices) {
                // Check each segment element to see if it contains the referenced transcript segment
                for (let i = 0; i < segmentElements.length; i++) {
                    const segmentDiv = segmentElements[i] as HTMLElement;
                    // Look for segment number in the badge - the index should be 1-based
                    const badge = segmentDiv.querySelector('.badge');
                    if (badge && badge.textContent === refIndex.toString()) {
                        targetElement = segmentDiv;
                        console.log(`Found target: refIndex=${refIndex}, badge.textContent=${badge.textContent}`);
                        break;
                    }
                }

                if (targetElement) break; // Found the first matching segment
            }

            if (targetElement) {
                console.log('Scrolling to segment:', targetElement); // Debug log
                (targetElement as HTMLElement).scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            } else {
                console.log('Target element not found for indices:', indices); // Debug log
            }
        }, 100);

        // Clear highlights after 5 seconds
        setTimeout(() => {
            setHighlightedSegments([]);
        }, 5000);
    };

    useEffect(() => {
        if (jobId) {
            apiClient.get(`/jobs/${jobId}`).then(response => {
                const jobData = response.data as JobDetails;
                setJob(jobData);

                // Parse transcript segments for reference mapping
                if (jobData.timing_info) {
                    try {
                        const timingData = JSON.parse(jobData.timing_info);
                        const segments = timingData.map((item: any, index: number) => ({
                            index: index + 1,
                            speaker: item.speaker || 'Unknown',
                            text: item.text || '',
                            start_time: item.start_time || 0,
                            end_time: item.end_time || 0
                        }));
                        setTranscriptSegments(segments);
                    } catch (error) {
                        console.error("Error parsing timing info:", error);
                    }
                }
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

  
    if (error) {
        return <div className="container mt-5 alert alert-danger">{error}</div>;
    }

    if (!job) {
        return <div className="container mt-5">Loading...</div>;
    }

    return (
        <div className="container-fluid mt-4 px-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>Job Details</h2>
                <div className="d-flex gap-2">
                    <button
                        className="btn btn-primary"
                        onClick={() => setIsAssistantOpen(true)}
                    >
                        <i className="bi bi-robot me-1"></i> Meeting Assistant
                    </button>
                    <button className="btn btn-outline-secondary" onClick={() => {
                        localStorage.removeItem('token');
                        window.location.href = '/login';
                    }}>
                        Logout
                    </button>
                    <Link to="/" className="btn btn-secondary">Back to Dashboard</Link>
                </div>
            </div>
            {isAssistantOpen && (
                <AssistantChat
                    job={{
                        id: job.id,
                        filename: job.filename,
                        status: job.status,
                        created_at: job.created_at,
                        summary: job.summary,
                        transcript: job.transcript,
                    }}
                    onClose={() => setIsAssistantOpen(false)}
                />
            )}

            {/* File Info Bar */}
            <div className="card mb-3">
                <div className="card-body py-2">
                    <div className="row align-items-center">
                        <div className="col">
                            <h5 className="mb-0">{job.filename}</h5>
                            <small className="text-muted">
                                Status: {job.status} | Date: {new Date(job.created_at).toLocaleString()}
                            </small>
                        </div>
                        <div className="col-auto">
                            <div className="d-flex gap-2 align-items-center">
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
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="row">
                {/* Left Panel - Transcript */}
                <div className="col-lg-7 mb-4">
                    <div className="card h-100">
                        <div className="card-header d-flex justify-content-between align-items-center">
                            <h5 className="mb-0">
                                Transcript
                                {highlightedSegments.length > 0 && (
                                    <span className="badge bg-warning text-dark ms-2">
                                        {highlightedSegments.length} segment{highlightedSegments.length > 1 ? 's' : ''} referenced
                                    </span>
                                )}
                            </h5>
                            {isSummarizing && (
                                <small className="text-muted">
                                    <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Generating summary...
                                </small>
                            )}
                        </div>
                        <div className="card-body" style={{ height: '75vh', padding: '0' }}>
                            {job.transcript ? (
                                <TranscriptEditor
                                    jobId={job.id}
                                    initialTranscript={job.transcript}
                                    highlightedSegments={highlightedSegments}
                                    onTranscriptUpdate={(updatedTranscript) => {
                                        // Update the job state with the new transcript
                                        setJob({...job, transcript: updatedTranscript});
                                    }}
                                />
                            ) : (
                                <div className="alert alert-info">Processing transcript...</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Panel - Meeting Summary */}
                <div className="col-lg-5 mb-4">
                    <div className="card h-100">
                        <div className="card-header">
                            <h5 className="mb-0">Meeting Summary</h5>
                        </div>
                        <div className="card-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
                            <SummaryWithReferences
                                summary={job?.summary}
                                transcriptSegments={transcriptSegments}
                                onSegmentClick={handleSegmentReference}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}