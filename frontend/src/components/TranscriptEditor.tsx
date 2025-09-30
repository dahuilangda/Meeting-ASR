import React, { useState, useRef, useEffect } from 'react';
import { apiClient } from '../api';

export interface TranscriptSegment {
  id: number;
  text: string;
  startTime: number;
  endTime: number;
  speaker: string;
}

interface JobDetails {
  id: number;
  filename: string;
  status: string;
  created_at: string;
  transcript: string | null;
  timing_info: string | null; // JSON string containing timing information
}

interface TimingInfoItem {
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface TranscriptEditorProps {
  jobId: number;
  initialTranscript: string | null;
  onTranscriptUpdate: (updatedTranscript: string) => void;
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({ 
  jobId, 
  initialTranscript, 
  onTranscriptUpdate 
}) => {
  const [, setTranscript] = useState<string | null>(initialTranscript);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(true); // Track if audio is still loading
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSpeakerPlaying, setCurrentSpeakerPlaying] = useState<number | null>(null);

  // Group consecutive segments by the same speaker for better presentation
  const groupedSegments = segments.reduce((acc, current) => {
    if (acc.length === 0) {
      acc.push({
        id: current.id,
        text: current.text,
        startTime: current.startTime,
        endTime: current.endTime,
        speaker: current.speaker,
        originalSegments: [current]
      });
    } else {
      const lastGroup = acc[acc.length - 1];
      if (lastGroup.speaker === current.speaker) {
        // Same speaker as previous, merge the segments
        lastGroup.text += ' ' + current.text;
        lastGroup.endTime = current.endTime;
        lastGroup.originalSegments.push(current);
      } else {
        // Different speaker, create a new group
        acc.push({
          id: current.id,
          text: current.text,
          startTime: current.startTime,
          endTime: current.endTime,
          speaker: current.speaker,
          originalSegments: [current]
        });
      }
    }
    return acc;
  }, [] as (TranscriptSegment & { originalSegments: TranscriptSegment[] })[]);

  // Fetch job details to get timing information
  useEffect(() => {
    setIsAudioLoading(true);
    const fetchJobDetails = async () => {
      try {
        const response = await apiClient.get(`/jobs/${jobId}`);
        const jobDetails: JobDetails = response.data;
        
        if (jobDetails.timing_info) {
          try {
            const timingData: TimingInfoItem[] = JSON.parse(jobDetails.timing_info);
            const parsedSegments: TranscriptSegment[] = timingData.map((item, index) => ({
              id: index,
              text: item.text,
              startTime: item.start_time,
              endTime: item.end_time,
              speaker: item.speaker
            }));
            setSegments(parsedSegments);
          } catch (error) {
            console.error("Error parsing timing info:", error);
            // Fallback to parsing transcript text if timing info is invalid
            setSegments(parseTranscriptFallback(jobDetails.transcript || ''));
          }
        } else {
          // If no timing info available, parse from transcript text
          setSegments(parseTranscriptFallback(jobDetails.transcript || ''));
        }
        
        // Create an authenticated audio URL by fetching the audio file content and creating a blob URL
        // This handles authentication properly since we use the apiClient which includes the auth token
        try {
          const audioResponse = await apiClient.get(`/jobs/${jobId}/audio`, {
            responseType: 'blob' // Important: get as blob
          });
          const audioBlob = new Blob([audioResponse.data], { type: audioResponse.headers['content-type'] || 'audio/mpeg' });
          const audioBlobUrl = URL.createObjectURL(audioBlob);
          
          setAudioUrl(audioBlobUrl);
          setIsAudioLoading(false);
        } catch (audioError) {
          console.error("Error fetching audio file:", audioError);
          setAudioError("Unable to load audio file. Audio playback may not work.");
          setAudioUrl(null);
          setIsAudioLoading(false);
        }
      } catch (error) {
        console.error("Error fetching job details:", error);
        // Fallback to parsing transcript text
        setSegments(parseTranscriptFallback(initialTranscript || ''));
        setAudioError("Unable to load job details. Audio playback may not work.");
        setAudioUrl(null); // Don't set audio URL if job details fail
        setIsAudioLoading(false);
      }
    };

    fetchJobDetails();
  }, [jobId, initialTranscript]);

  // Effect to handle cleanup of previous audio URL
  useEffect(() => {
    // This effect runs when audioUrl changes - clean up previous URL
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Fallback function to parse transcript when timing info is not available
  const parseTranscriptFallback = (transcriptText: string): TranscriptSegment[] => {
    if (!transcriptText) return [];
    
    const lines = transcriptText.split('\n').filter(line => line.trim() !== '');
    return lines.map((line, index) => {
      const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (match) {
        return {
          id: index,
          text: match[2],
          startTime: index * 5, // Placeholder timing
          endTime: (index + 1) * 5, // Placeholder timing
          speaker: match[1]
        };
      }
      return {
        id: index,
        text: line,
        startTime: index * 5,
        endTime: (index + 1) * 5,
        speaker: 'Unknown'
      };
    });
  };

  const handleOptimize = async () => {
    if (!jobId) return;
    
    setIsOptimizing(true);
    try {
      const response = await apiClient.post(`/jobs/${jobId}/optimize`);
      setTranscript(response.data.transcript);
      onTranscriptUpdate(response.data.transcript || '');
      
      // Refresh timing info after optimization
      if (response.data.timing_info) {
        try {
          const timingData: TimingInfoItem[] = JSON.parse(response.data.timing_info);
          const parsedSegments: TranscriptSegment[] = timingData.map((item, index) => ({
            id: index,
            text: item.text,
            startTime: item.start_time,
            endTime: item.end_time,
            speaker: item.speaker
          }));
          setSegments(parsedSegments);
        } catch (error) {
          console.error("Error parsing timing info after optimization:", error);
        }
      }
    } catch (err) {
      console.error("Optimization failed", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleSegmentClick = (startTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play();
      setIsPlaying(true);
      setCurrentSpeakerPlaying(null); // Reset individual speaker playback state when clicking segment
    }
  };

  const handleSpeakerPlay = (startTime: number, segmentId: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play();
      setIsPlaying(true);
      setCurrentSpeakerPlaying(segmentId); // Track which speaker segment is currently playing
    }
  };

  const handleSpeakerPause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      setCurrentSpeakerPlaying(null);
    }
  };

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
      if (isPlaying) {
        setCurrentSpeakerPlaying(null); // Reset when global play/pause is used
      }
    }
  };

  const handleAudioEnd = () => {
    setIsPlaying(false);
    setCurrentSpeakerPlaying(null);
  };

  const [audioError, setAudioError] = useState<string | null>(null);

  const handleAudioError = () => {
    console.error("Audio error occurred");
    setAudioError("Audio file could not be loaded. Either the file is unavailable or there was a connection issue.");
  };

  return (
    <div className="transcript-editor">
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button 
          className="btn btn-primary" 
          onClick={handleOptimize} 
          disabled={isOptimizing}
          title="Optimize transcript with advanced AI"
        >
          {isOptimizing ? 'Optimizing...' : 'Optimize with AI'}
        </button>
        
        <div className="d-flex align-items-center gap-2 ms-auto">
          {audioUrl && !isAudioLoading ? (
            <>
              <audio 
                ref={audioRef} 
                src={audioUrl} 
                onEnded={handleAudioEnd}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={handleAudioError}
              />
              <button 
                className="btn btn-outline-secondary" 
                onClick={handlePlayPause}
                disabled={!!audioError}
              >
                {isPlaying ? 'Pause' : 'Play All Audio'}
              </button>
            </>
          ) : isAudioLoading ? (
            <span className="text-muted">Loading audio...</span>
          ) : (
            <span className="text-muted">Audio unavailable</span>
          )}
        </div>
      </div>

      {audioError && (
        <div className="alert alert-warning mb-3">
          <small>{audioError}</small>
        </div>
      )}

      <div className="transcript-container">
        {groupedSegments.map((group, index) => {
          // Generate a consistent color based on speaker name for visual distinction
          const getSpeakerColor = (speaker: string) => {
            // Create a consistent color mapping based on speaker name
            const colors = [
              '#e3f2fd', // light blue
              '#f3e5f5', // light purple  
              '#e8f5e8', // light green
              '#fff3e0', // light orange
              '#fce4ec', // light pink
              '#f1f8e9', // light lime
              '#e0f7fa', // light cyan
              '#fff8e1', // light yellow
            ];
            
            // Create a hash of the speaker name to get consistent colors
            let hash = 0;
            for (let i = 0; i < speaker.length; i++) {
              hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
            }
            const index = Math.abs(hash) % colors.length;
            return colors[index];
          };
          
          // Generate a border color that's slightly darker than the background for better definition
          const getSpeakerBorderColor = (speaker: string) => {
            const colors = [
              '#bbdefb', // medium blue
              '#e1bee7', // medium purple
              '#c8e6c9', // medium green
              '#ffe0b2', // medium orange
              '#f8bbd0', // medium pink
              '#dcedc8', // medium lime
              '#b2ebf2', // medium cyan
              '#fff59d', // medium yellow
            ];
            
            // Create a hash of the speaker name to get consistent colors
            let hash = 0;
            for (let i = 0; i < speaker.length; i++) {
              hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
            }
            const index = Math.abs(hash) % colors.length;
            return colors[index];
          };
          
          const bgColor = getSpeakerColor(group.speaker);
          const borderColor = getSpeakerBorderColor(group.speaker);
          const isCurrentlyPlaying = currentSpeakerPlaying === group.id;
          
          return (
            <div 
              key={group.id} 
              className="transcript-segment p-3 mb-3 rounded border"
              style={{ 
                fontSize: '0.9rem',
                backgroundColor: bgColor,
                borderColor: borderColor,
                borderLeftWidth: '4px',
                boxShadow: isCurrentlyPlaying ? '0 0 8px rgba(0,0,0,0.2)' : 'none'
              }}
            >
              <div className="segment-header d-flex justify-content-between align-items-center mb-2">
                <div className="d-flex align-items-center gap-2">
                  <span className="badge rounded-pill" 
                        style={{ 
                          backgroundColor: borderColor,
                          color: '#000',
                          fontSize: '0.8rem' 
                        }}>
                    {group.speaker}
                  </span>
                  <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {new Date(group.startTime * 1000).toISOString().substr(11, 8)} - {new Date(group.endTime * 1000).toISOString().substr(11, 8)}
                  </small>
                </div>
                <div>
                  <button 
                    className={`btn btn-sm ${isCurrentlyPlaying ? 'btn-danger' : 'btn-outline-primary'}`}
                    onClick={() => isCurrentlyPlaying ? handleSpeakerPause() : handleSpeakerPlay(group.startTime, group.id)}
                    title={isCurrentlyPlaying ? 'Stop playback' : 'Play this section'}
                    disabled={isAudioLoading || !!audioError}
                  >
                    {isCurrentlyPlaying ? (
                      <>
                        <i className="bi bi-stop-fill me-1"></i> Stop
                      </>
                    ) : isAudioLoading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" role="status"></span> Loading
                      </>
                    ) : (
                      <>
                        <i className="bi bi-play-fill me-1"></i> Play
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p 
                className="mb-0" 
                style={{ 
                  lineHeight: '1.5',
                  cursor: 'pointer'
                }}
                onClick={() => handleSegmentClick(group.startTime)}
              >
                {group.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};