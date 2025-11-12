import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient, generateSummary } from '../api';
import { JobWebSocketClient, WebSocketMessage } from '../websocket';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { SummaryWithReferences } from '../components/SummaryWithReferences';
import { AssistantChat } from '../components/AssistantChat';
import ShareManagerModal from '../components/ShareManagerModal';

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

const getFilenameFromContentDisposition = (header?: string | null): string | null => {
    if (!header) {
        return null;
    }

    const filenameStarMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (filenameStarMatch) {
        try {
            return decodeURIComponent(filenameStarMatch[1]);
        } catch {
            return filenameStarMatch[1];
        }
    }

    const filenameMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
    return filenameMatch ? filenameMatch[1] : null;
};

export function JobDetailPage() {
    const { jobId } = useParams<{ jobId: string }>();
    const [job, setJob] = useState<JobDetails | null>(null);
    const [error, setError] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('Chinese');
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
    const [highlightedSegments, setHighlightedSegments] = useState<number[]>([]);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);

    // Resizable panel states
    const [leftPanelWidth, setLeftPanelWidth] = useState(60); // percentage
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const summarizeLockRef = useRef(false);
    
    // Initialize activeTab from URL hash or default to 'transcript'
    const getInitialTab = () => {
        const hash = window.location.hash;
        if (hash === '#summary') return 'summary';
        return 'transcript'; // default
    };
    
    const [activeTab, setActiveTab] = useState(getInitialTab);
    
    const [isSummarizing, setIsSummarizing] = useState(false);

    // Resizable panel handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

        // Constrain width between 30% and 80%
        const constrainedWidth = Math.max(30, Math.min(80, newLeftWidth));
        setLeftPanelWidth(constrainedWidth);
    }, [isResizing]);

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    }, []);

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, handleMouseMove, handleMouseUp]);

    const handleSegmentReference = useCallback((segmentIndices: number | number[]) => {
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
    }, []);

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
            }).catch(() => {
                setError('Failed to fetch job details.');
            });
        }
    }, [jobId]);

    useEffect(() => {
        const numericJobId = jobId ? parseInt(jobId, 10) : NaN;
        if (!jobId || Number.isNaN(numericJobId)) {
            return;
        }

        try {
            const client = JobWebSocketClient.fromLocalStorage();

            client.onMessage((message: WebSocketMessage) => {
                if (message.type !== 'summary_updated') {
                    return;
                }
                if (!message.job_id || message.job_id !== numericJobId) {
                    return;
                }

                summarizeLockRef.current = false;
                setIsSummarizing(false);

                const updatedSummary = typeof message.summary === 'string' ? message.summary : null;
                const incomingStatus = typeof message.status === 'string' ? message.status : undefined;

                setJob(prev => {
                    if (!prev) {
                        return prev;
                    }
                    return {
                        ...prev,
                        summary: updatedSummary ?? prev.summary,
                        status: incomingStatus ?? prev.status,
                    };
                });
            });

            client.connect().catch(err => {
                console.error('Failed to connect job detail WebSocket:', err);
            });

            return () => {
                client.disconnect();
            };
        } catch (err) {
            console.error('Failed to initialize WebSocket for job detail page:', err);
        }
    }, [jobId]);

    // Update URL hash when activeTab changes
    useEffect(() => {
        window.location.hash = activeTab;
    }, [activeTab]);

    
    const handleSummarize = async () => {
        if (!jobId) return;
        if (summarizeLockRef.current) return;
        summarizeLockRef.current = true;
        setActiveTab('summary'); // Switch to summary tab immediately
        setIsSummarizing(true);
        try {
            const jobData = await generateSummary(parseInt(jobId), targetLanguage);
            setJob(jobData as JobDetails); // Update job with summary
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
            summarizeLockRef.current = false;
            setIsSummarizing(false);
        }
    };

    const downloadFile = useCallback(
        async (endpoint: string, fallbackSuffix: string, defaultContentType: string) => {
            if (!job) {
                return;
            }

            try {
                const response = await apiClient.get<Blob>(endpoint, { responseType: 'blob' });
                const headers = response.headers as Record<string, string | undefined>;
                const contentDisposition =
                    headers['content-disposition'] ?? headers['Content-Disposition'] ?? null;
                const contentType =
                    headers['content-type'] ?? headers['Content-Type'] ?? defaultContentType;
                const blob =
                    response.data instanceof Blob
                        ? response.data
                        : new Blob([response.data], { type: contentType });
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                const baseName = job.filename ? job.filename.replace(/\.[^/.]+$/, '') : `job-${job.id}`;
                const fallbackName = `${baseName}${fallbackSuffix}`;
                const filename = getFilenameFromContentDisposition(contentDisposition) || fallbackName;

                link.href = downloadUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(downloadUrl);
            } catch (err) {
                console.error(`Failed to download from ${endpoint}`, err);
                alert('Download failed, please try again later.');
            }
        },
        [job]
    );

    const handleAudioDownload = useCallback(() => {
        if (!job) {
            return;
        }
        const extension = job.filename?.match(/\.[^/.]+$/)?.[0] ?? '';
        downloadFile(`/jobs/${job.id}/audio`, extension, 'application/octet-stream');
    }, [downloadFile, job]);

  
    if (error) {
        return <div className="container mt-5 alert alert-danger">{error}</div>;
    }

    if (!job) {
        return <div className="container mt-5">Loading...</div>;
    }

    return (
        <>
            <div className="container-fluid mt-4 px-4">
            <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
                <h2>Job Details</h2>
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-end">
                    <button
                        className="btn btn-outline-primary"
                        onClick={() => setIsShareModalOpen(true)}
                    >
                        <i className="bi bi-share me-1"></i> Share
                    </button>
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
                            <div className="d-flex flex-wrap gap-2 align-items-center justify-content-end">
                                <select
                                    className="form-select form-select-sm w-auto"
                                    value={targetLanguage}
                                    onChange={e => setTargetLanguage(e.target.value)}
                                    disabled={isSummarizing}
                                    style={{ minWidth: '140px' }}
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
                                    className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2 px-3"
                                    style={{ minHeight: '34px', fontSize: '0.85rem' }}
                                    onClick={handleSummarize}
                                    disabled={isSummarizing}
                                >
                                    <span
                                        className="d-inline-flex align-items-center justify-content-center"
                                        style={{ width: '1.25rem' }}
                                    >
                                        {isSummarizing ? (
                                            <span className="spinner-border spinner-border-sm" role="status"></span>
                                        ) : (
                                            <i className="bi bi-journal-text"></i>
                                        )}
                                    </span>
                                    <span className="text-nowrap">
                                        {isSummarizing ? 'Generating...' : 'Generate Summary'}
                                    </span>
                                </button>
                                <button
                                    className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-2 px-3"
                                    style={{ minHeight: '34px', fontSize: '0.85rem' }}
                                    onClick={handleAudioDownload}
                                >
                                    <i className="bi bi-download"></i>
                                    <span>Download Audio</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div
                ref={containerRef}
                className="d-flex mb-4"
                style={{ height: '75vh', position: 'relative' }}
            >
                {/* Left Panel - Transcript */}
                <div
                    style={{
                        width: `${leftPanelWidth}%`,
                        minWidth: '30%',
                        maxWidth: '80%'
                    }}
                >
                    <div className="card h-100">
                        <div className="card-body" style={{ height: '100%', padding: '0' }}>
                            {job.transcript ? (
                                <TranscriptEditor
                                    jobId={job.id}
                                    initialTranscript={job.transcript}
                                    highlightedSegments={highlightedSegments}
                                    canDownloadTranscript={Boolean(job.transcript)}
                                    onDownloadTranscript={() =>
                                        downloadFile(
                                            `/jobs/${job.id}/transcript/download`,
                                            '_transcript.txt',
                                            'text/plain;charset=utf-8'
                                        )
                                    }
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

                {/* Resizable Divider */}
                <div
                    style={{
                        width: '4px',
                        backgroundColor: '#e9ecef',
                        cursor: 'col-resize',
                        position: 'relative',
                        flexShrink: 0,
                        transition: isResizing ? 'none' : 'background-color 0.2s',
                    }}
                    onMouseDown={handleMouseDown}
                    className="border-start border-end"
                >
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '2px',
                            height: '30px',
                            backgroundColor: '#adb5bd',
                            borderRadius: '1px',
                        }}
                    />
                </div>

                {/* Right Panel - Meeting Summary */}
                <div
                    style={{
                        width: `${100 - leftPanelWidth}%`,
                        minWidth: '20%',
                        maxWidth: '70%'
                    }}
                >
                    <div className="card h-100">
                        <div className="card-body p-0" style={{ height: '100%', overflowY: 'auto' }}>
                            <SummaryWithReferences
                                summary={job?.summary}
                                jobId={job.id}
                                transcriptSegments={transcriptSegments}
                                onSegmentClick={handleSegmentReference}
                                canDownloadSummary={Boolean(job.summary)}
                                onDownloadSummary={() =>
                                    downloadFile(
                                        `/jobs/${job.id}/summary/download`,
                                        '_summary.md',
                                        'text/markdown;charset=utf-8'
                                    )
                                }
                                onSummaryUpdate={(updatedSummary) => {
                                    setJob(prev => prev ? { ...prev, summary: updatedSummary } : prev);
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
            </div>
            <ShareManagerModal
                jobId={job.id}
                jobFilename={job.filename}
                show={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
            />
        </>
    );
}
