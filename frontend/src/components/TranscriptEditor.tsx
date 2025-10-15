import React, { useState, useRef, useEffect } from 'react';
import { apiClient } from '../api';

export interface TranscriptSegment {
  id: number;
  text: string;
  startTime: number;
  endTime: number;
  speaker: string;
  doNotMergeWithPrevious?: boolean;
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
  const [transcript, setTranscript] = useState<string | null>(initialTranscript);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(true); // Track if audio is still loading
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [originalTranscript, setOriginalTranscript] = useState<TranscriptSegment[] | null>(null);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSpeakerPlaying, setCurrentSpeakerPlaying] = useState<number | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editingSpeakerForSegment, setEditingSpeakerForSegment] = useState<number | null>(null); // Track which segment is being edited
  // Removed unused state variables: translatedSegments, isTranslating
  const renameInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) {
      return '00:00:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (editingSpeakerForSegment !== null && renameInputRef.current) {
      // Use setTimeout to ensure the element is rendered before focusing
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          // Select all text for easy editing
          renameInputRef.current.select();
        }
      }, 0);
    }
  }, [editingSpeakerForSegment]);
  
  const buildTranscriptPayload = (updatedSegments: TranscriptSegment[]) => {
    console.log("Building payload with segments:", updatedSegments); // Debug log
    return {
      transcript: updatedSegments.map((segment, index) => {
        // Use the segment's actual timing if available and valid
        const safeStart = (segment.startTime >= 0 && Number.isFinite(segment.startTime)) ? segment.startTime : index * 5;
        const safeEnd = (segment.endTime >= 0 && Number.isFinite(segment.endTime)) ? segment.endTime : safeStart + 5;

        console.log(`Payload segment ${index}:`, {
          start_time: safeStart,
          end_time: safeEnd,
          original_start: segment.startTime,
          original_end: segment.endTime
        }); // Debug log

        return {
          line_number: index,
          text: segment.text || '',
          speaker: segment.speaker || 'Unknown',
          start_time: safeStart,
          end_time: safeEnd,
          do_not_merge_with_previous: Boolean(segment.doNotMergeWithPrevious),
        };
      }),
    };
  };

  const saveTranscript = async (updatedSegments: TranscriptSegment[]) => {
    try {
      const payload = buildTranscriptPayload(updatedSegments);
      await apiClient.post(`/jobs/${jobId}/transcript`, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      const updatedTranscriptText = updatedSegments
        .map(segment => `[${segment.speaker || 'Unknown'}] ${segment.text}`)
        .join('\n');
      onTranscriptUpdate(updatedTranscriptText);
    } catch (error) {
      console.error('Error saving transcript:', error);
    }
  };

  const handleSpeakerNameChange = (oldName: string, newName: string) => {
    // Find the original speaker name of the group currently being edited
    // When a user renames a speaker, they want to rename all segments with that speaker name
    const updatedSegments = segments.map(segment => {
      if (segment.speaker === oldName) {
        return { ...segment, speaker: newName };
      }
      return segment;
    });
    
    setSegments(updatedSegments);
    setEditingSpeakerForSegment(null);
    saveTranscript(updatedSegments);
  };

  const handleSegmentSpeakerChange = (segmentIds: number[], newName: string) => {
    const updatedSegments = segments.map(segment => {
      if (segmentIds.includes(segment.id)) {
        // When changing speaker via dropdown, preserve existing doNotMergeWithPrevious value
        // to maintain existing groupings, only change the speaker.
        return { ...segment, speaker: newName };
      }
      return segment;
    });
    
    setSegments(updatedSegments);
    saveTranscript(updatedSegments);
  };

  const handleDeleteSegment = (segmentIds: number[]) => {
    const lastSegmentId = segmentIds[segmentIds.length - 1];
    const lastSegmentIndex = segments.findIndex(s => s.id === lastSegmentId);

    const updatedSegments = segments.filter(segment => !segmentIds.includes(segment.id));

    if (lastSegmentIndex !== -1 && lastSegmentIndex < segments.length - 1) {
      const nextSegmentIndex = updatedSegments.findIndex(s => s.startTime >= segments[lastSegmentIndex].endTime);
      if (nextSegmentIndex !== -1) {
        updatedSegments[nextSegmentIndex].doNotMergeWithPrevious = true;
      }
    }

    setSegments(updatedSegments);
    saveTranscript(updatedSegments);
  };

  const handleMergeSegment = (segmentId: number) => {
    const segmentIndex = segments.findIndex(segment => segment.id === segmentId);
    if (segmentIndex === -1 || segmentIndex === segments.length - 1) {
      return; // Cannot merge last segment
    }

    const currentSegment = segments[segmentIndex];
    const nextSegment = segments[segmentIndex + 1];

    const mergedSegment: TranscriptSegment = {
      ...currentSegment,
      text: currentSegment.text + ' ' + nextSegment.text,
      endTime: nextSegment.endTime,
    };

    const updatedSegments = [
      ...segments.slice(0, segmentIndex),
      mergedSegment,
      ...segments.slice(segmentIndex + 2),
    ];

    setSegments(updatedSegments);
    saveTranscript(updatedSegments);
  };

  const handleSplitSegment = (segmentId: number) => {
    console.log('Splitting segment:', segmentId);
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      console.log('No selection or range count is zero');
      return;
    }

    const range = selection.getRangeAt(0);
    const { startOffset, startContainer } = range;
    console.log('Range:', range, 'Start offset:', startOffset, 'Start container:', startContainer);

    if (!startContainer || !startContainer.parentElement?.isContentEditable) {
      console.log('Start container is not content editable');
      return;
    }

    const segmentIndex = segments.findIndex(segment => segment.id === segmentId);
    console.log('Segment index:', segmentIndex);
    if (segmentIndex === -1) return;

    const currentSegment = segments[segmentIndex];
    const originalText = currentSegment.text;
    console.log('Current segment:', currentSegment);

    if (startOffset === 0 || startOffset === originalText.length) {
      console.log('Cannot split at the beginning or end');
      return;
    }

    const textBefore = originalText.slice(0, startOffset);
    const textAfter = originalText.slice(startOffset);

    const duration = currentSegment.endTime - currentSegment.startTime;
    // Check for valid duration to prevent NaN
    if (isNaN(duration) || !isFinite(duration)) {
      console.error('Invalid duration for segment:', currentSegment);
      return;
    }
    
    const splitTime = currentSegment.startTime + (duration * (startOffset / originalText.length));
    
    // Check for valid splitTime to prevent invalid time values
    if (isNaN(splitTime) || !isFinite(splitTime)) {
      console.error('Invalid split time calculated:', { 
        startTime: currentSegment.startTime, 
        endTime: currentSegment.endTime, 
        duration, 
        startOffset, 
        originalTextLength: originalText.length
      });
      return;
    }

    const updatedSegment: TranscriptSegment = {
      ...currentSegment,
      text: textBefore,
      endTime: splitTime,
    };

    const newSegment: TranscriptSegment = {
      id: Date.now(), // Simple unique ID generation
      text: textAfter,
      startTime: splitTime,
      endTime: currentSegment.endTime,
      speaker: currentSegment.speaker,
      doNotMergeWithPrevious: true,
    };

    const updatedSegments = [
      ...segments.slice(0, segmentIndex),
      updatedSegment,
      newSegment,
      ...segments.slice(segmentIndex + 1),
    ];
    console.log('Updated segments:', updatedSegments);

    setSegments(updatedSegments);
    saveTranscript(updatedSegments);
  };

  const handleEditClick = (segment: TranscriptSegment) => {
    setEditingSegmentId(segment.id);
  };

  const uniqueSpeakers = [...new Set(segments.map(segment => segment.speaker))];

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
      if (lastGroup.speaker === current.speaker && !current.doNotMergeWithPrevious) {
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
        const jobDetails: any = response.data;
        
        if (jobDetails.timing_info) {
          try {
            const timingData = JSON.parse(jobDetails.timing_info);
            console.log("Timing data received:", timingData); // Debug log
            const parsedSegments: TranscriptSegment[] = timingData.map((item: any, index: number) => {
              const segment = {
                id: index,
                text: item.text || '',
                startTime: parseFloat(item.start_time) || 0,
                endTime: parseFloat(item.end_time) || 0,
                speaker: item.speaker || 'Unknown',
                doNotMergeWithPrevious: Boolean(item.do_not_merge_with_previous)
              };
              console.log(`Segment ${index}:`, segment); // Debug log
              return segment;
            });
            setSegments(parsedSegments);
            setOriginalTranscript(parsedSegments); // Store original transcript
          } catch (error) {
            console.error("Error parsing timing info:", error);
            // Fallback to parsing transcript text if timing info is invalid
            const fallbackSegments = parseTranscriptFallback(jobDetails.transcript || '');
            setSegments(fallbackSegments);
            setOriginalTranscript(fallbackSegments);
          }
        } else {
          // If no timing info available, parse from transcript text
          const fallbackSegments = parseTranscriptFallback(jobDetails.transcript || '');
          setSegments(fallbackSegments);
          setOriginalTranscript(fallbackSegments);
        }
        
        // Create an authenticated audio URL by fetching the audio file content and creating a blob URL
        // This handles authentication properly since we use the apiClient which includes the auth token
        try {
          const audioResponse = await apiClient.get(`/jobs/${jobId}/audio`, {
            responseType: 'blob' // Important: get as blob
          });
          const audioBlob = new Blob([audioResponse.data as BlobPart], { type: audioResponse.headers['content-type'] || 'audio/mpeg' });
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
          startTime: index * 5, // Improved fallback timing: 0, 5, 10, 15...
          endTime: (index + 1) * 5,
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

  // Function to refresh transcript segments with latest timing data
  const refreshTranscriptSegments = async () => {
    try {
      const response = await apiClient.get(`/jobs/${jobId}`);
      const jobDetails: any = response.data;

      if (jobDetails.timing_info) {
        try {
          const timingData = JSON.parse(jobDetails.timing_info);
          console.log("Refreshing with timing data:", timingData); // Debug log
          const refreshedSegments: TranscriptSegment[] = timingData.map((item: any, index: number) => ({
            id: index,
            text: item.text || '',
            startTime: parseFloat(item.start_time) || 0,
            endTime: parseFloat(item.end_time) || 0,
            speaker: item.speaker || 'Unknown',
            doNotMergeWithPrevious: Boolean(item.do_not_merge_with_previous)
          }));

          console.log("Refreshed segments:", refreshedSegments); // Debug log
          setSegments(refreshedSegments);
          setOriginalTranscript(refreshedSegments);
        } catch (error) {
          console.error("Error refreshing timing info:", error);
        }
      }
    } catch (error) {
      console.error("Error refreshing transcript:", error);
    }
  };

  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        setEditingSegmentId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSpeakerPlay = (startTime: number, segmentId: number) => {
    console.log(`Playing segment ${segmentId} at time ${startTime}s`); // Debug log
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

  const handleOptimizeAll = async () => {
    try {
      await apiClient.post(`/jobs/${jobId}/optimize`);
      // Refresh the job details to get the optimized transcript
      const response = await apiClient.get(`/jobs/${jobId}`);
      const jobDetails: any = response.data;
      // Update the segments with the optimized transcript
      if (jobDetails.transcript && jobDetails.timing_info) {
        try {
          const timingData = JSON.parse(jobDetails.timing_info);
          const parsedSegments: TranscriptSegment[] = timingData.map((item: any, index: number) => ({
            id: index,
            text: item.text,
            startTime: item.start_time,
            endTime: item.end_time,
            speaker: item.speaker,
            doNotMergeWithPrevious: Boolean(item.do_not_merge_with_previous)
          }));
          setSegments(parsedSegments);
        } catch (error) {
          console.error("Error parsing timing info:", error);
          // Fallback to parsing transcript text if timing info is invalid
          setSegments(parseTranscriptFallback(jobDetails.transcript || ''));
        }
      }
      alert('Transcript optimized successfully!');
    } catch (error) {
      console.error('Error optimizing transcript:', error);
      alert('Failed to optimize transcript. Please try again.');
    }
  };

  return (
    <div className="transcript-editor" ref={editorRef}>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div className="d-flex align-items-center gap-2">
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
                className="btn btn-sm btn-outline-secondary"
                onClick={handlePlayPause}
                disabled={!!audioError}
              >
                {isPlaying ? (
                  <i className="bi bi-pause-fill"></i>
                ) : (
                  <i className="bi bi-play-fill"></i>
                )}
              </button>
            </>
          ) : isAudioLoading ? (
            <span className="text-muted"><span className="spinner-border spinner-border-sm me-1"></span>Loading...</span>
          ) : (
            <span className="text-muted">Audio unavailable</span>
          )}
        </div>

        <div className="d-flex align-items-center gap-1">
          <button
            className="btn btn-sm btn-outline-success"
            onClick={() => {
              // Save current changes to backend and update original
              saveTranscript(segments).then(() => {
                setOriginalTranscript([...segments]);
                setHasChanges(false);
              });
            }}
            disabled={!hasChanges}
            title="Save current changes"
          >
            <i className="bi bi-save"></i> Save
          </button>
          <button
            className="btn btn-sm btn-outline-warning"
            onClick={() => {
              // Reset to original
              if (originalTranscript) {
                setSegments([...originalTranscript]);
                setHasChanges(false);
              }
            }}
            disabled={!hasChanges || !originalTranscript}
            title="Reset to original"
          >
            <i className="bi bi-arrow-clockwise"></i> Reset
          </button>
        </div>
      </div>

      {audioError && (
        <div className="alert alert-warning py-1 mb-2">
          <small>{audioError}</small>
        </div>
      )}

      <div className="transcript-container" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {groupedSegments.map((group, index) => {
          const getSpeakerColor = (speaker: string) => {
            const colors = [
              '#e3f2fd', '#f3e5f5', '#e8f5e8', '#fff3e0', '#fce4ec',
              '#f1f8e9', '#e0f7fa', '#fff8e1'
            ];

            let hash = 0;
            for (let i = 0; i < speaker.length; i++) {
              hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
            }
            const index = Math.abs(hash) % colors.length;
            return colors[index];
          };

          const getSpeakerBorderColor = (speaker: string) => {
            const colors = [
              '#bbdefb', '#e1bee7', '#c8e6c9', '#ffe0b2', '#f8bbd0',
              '#dcedc8', '#b2ebf2', '#fff59d'
            ];

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
          const isEditing = editingSegmentId === group.id;

          return (
            <div
              key={group.id}
              className={`transcript-segment p-2 mb-2 rounded border ${isEditing ? 'border-primary' : ''}`}
              style={{
                fontSize: '0.9rem',
                backgroundColor: bgColor,
                borderColor: isEditing ? '#007bff' : borderColor,
                borderLeftWidth: '3px',
                boxShadow: isCurrentlyPlaying ? '0 0 6px rgba(0,0,0,0.15)' : 'none'
              }}
            >
              <div className="segment-header d-flex justify-content-between align-items-center mb-1">
                <div className="d-flex align-items-center gap-2">
                  {editingSpeakerForSegment === group.id ? (
                    <div className="d-flex align-items-center">
                      <input
                        ref={renameInputRef}
                        type="text"
                        defaultValue={group.speaker}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSpeakerNameChange(group.speaker, (e.target as HTMLInputElement).value);
                          } else if (e.key === 'Escape') {
                            setEditingSpeakerForSegment(null);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value !== group.speaker) {
                            handleSpeakerNameChange(group.speaker, e.target.value);
                          } else {
                            setEditingSpeakerForSegment(null);
                          }
                        }}
                        className="form-control form-control-sm me-1"
                        style={{ fontSize: '0.8rem', width: '120px' }}
                      />
                      <button
                        className="btn btn-sm btn-outline-secondary py-0"
                        onClick={() => setEditingSpeakerForSegment(null)}
                        style={{ fontSize: '0.7rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="dropdown">
                      <button
                        className="btn btn-sm dropdown-toggle py-0"
                        type="button"
                        data-bs-toggle="dropdown"
                        aria-expanded="false"
                        style={{
                          backgroundColor: borderColor,
                          color: '#000',
                          fontSize: '0.8rem',
                          padding: '2px 8px'
                        }}
                      >
                        {group.speaker}
                      </button>
                      <ul className="dropdown-menu">
                        {uniqueSpeakers.map(speaker => (
                          <li key={speaker}>
                            <button
                              className="dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSegmentSpeakerChange(group.originalSegments.map(s => s.id), speaker);
                              }}
                            >
                              {speaker}
                            </button>
                          </li>
                        ))}
                        <li><hr className="dropdown-divider" /></li>
                        <li>
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingSpeakerForSegment(group.id);
                            }}
                          >
                            Rename
                          </button>
                        </li>
                      </ul>
                    </div>
                  )}
                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {formatTime(group.startTime)} - {formatTime(group.endTime)}
                  </small>
                  <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>
                    {index + 1}
                  </span>
                </div>
                <div className='d-flex align-items-center gap-1'>
                  <button
                    className="btn btn-sm btn-outline-primary py-0"
                    onClick={() => handleSplitSegment(group.id)}
                    style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                    title="Split segment"
                  >
                    <i className="bi bi-scissors"></i>
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger py-0"
                    onClick={() => handleDeleteSegment(group.originalSegments.map(s => s.id))}
                    style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                    title="Delete segment"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                  <button
                    className="btn btn-sm btn-outline-secondary py-0"
                    onClick={() => handleMergeSegment(group.id)}
                    style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                    title="Merge with next"
                  >
                    <i className="bi bi-link"></i>
                  </button>
                  <button
                    className={`btn btn-sm py-0 ${isCurrentlyPlaying ? 'btn-danger' : 'btn-outline-primary'}`}
                    onClick={() => isCurrentlyPlaying ? handleSpeakerPause() : handleSpeakerPlay(group.startTime, group.id)}
                    title={isCurrentlyPlaying ? 'Stop playback' : 'Play this section'}
                    disabled={isAudioLoading || !!audioError}
                    style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                  >
                    {isCurrentlyPlaying ? (
                      <i className="bi bi-stop-fill"></i>
                    ) : isAudioLoading ? (
                      <span className="spinner-border spinner-border-sm" role="status"></span>
                    ) : (
                      <i className="bi bi-play-fill"></i>
                    )}
                  </button>
                </div>
              </div>
              <div
                contentEditable={isEditing}
                suppressContentEditableWarning={true}
                className="mb-0"
                style={{
                  lineHeight: '1.4',
                  cursor: isEditing ? 'text' : 'pointer',
                  outline: isEditing ? '1px solid #007bff' : 'none',
                  padding: isEditing ? '0.25rem' : '0',
                  borderRadius: isEditing ? '0.25rem' : '0',
                  minHeight: '1.2rem'
                }}
                onBlur={(e) => {
                  if (!e.relatedTarget || !editorRef.current?.contains(e.relatedTarget as Node)) {
                    const editedText = e.currentTarget.innerText;
                    const originalIds = new Set(group.originalSegments.map(s => s.id));
                    let replacementInserted = false;

                    const updatedSegments = segments.reduce<TranscriptSegment[]>((acc, segment) => {
                      if (originalIds.has(segment.id)) {
                        if (!replacementInserted) {
                          const firstOriginal = group.originalSegments[0];
                          acc.push({
                            ...segment,
                            text: editedText,
                            startTime: group.startTime,
                            endTime: group.endTime,
                            doNotMergeWithPrevious: Boolean(firstOriginal?.doNotMergeWithPrevious),
                          });
                          replacementInserted = true;
                        }
                        return acc;
                      }
                      acc.push(segment);
                      return acc;
                    }, []);

                    setSegments(updatedSegments);
                    setHasChanges(true);
                    saveTranscript(updatedSegments);
                    setEditingSegmentId(null);
                  }
                }}
                onClick={() => !isEditing && handleEditClick(group)}
              >
                {group.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};