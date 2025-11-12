import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  highlightedSegments?: number[];
  onDownloadTranscript?: () => void;
  canDownloadTranscript?: boolean;
}

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  jobId,
  initialTranscript,
  onTranscriptUpdate,
  highlightedSegments = [],
  onDownloadTranscript,
  canDownloadTranscript = false
}) => {
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false); // Track if audio is being fetched
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [originalTranscript, setOriginalTranscript] = useState<TranscriptSegment[] | null>(null);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSpeakerPlaying, setCurrentSpeakerPlaying] = useState<number | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editingSpeakerForSegment, setEditingSpeakerForSegment] = useState<number | null>(null); // Track which segment is being edited
  const [openDropdownForSegment, setOpenDropdownForSegment] = useState<number | null>(null); // Track which segment's dropdown is open
  const renameInputRef = useRef<HTMLInputElement>(null);
  const speakerColorPalette = React.useMemo(
    () => [
      { bg: '#e3f2fd', border: '#bbdefb' },
      { bg: '#f3e5f5', border: '#e1bee7' },
      { bg: '#e8f5e8', border: '#c8e6c9' },
      { bg: '#fff3e0', border: '#ffe0b2' },
      { bg: '#fce4ec', border: '#f8bbd0' },
      { bg: '#f1f8e9', border: '#dcedc8' },
      { bg: '#e0f7fa', border: '#b2ebf2' },
      { bg: '#fff8e1', border: '#fff59d' }
    ],
    []
  );
  const colorIndexRef = useRef(0);
  const [speakerColorMap, setSpeakerColorMap] = useState<Record<string, { bg: string; border: string }>>({});
  const [audioDownloadProgress, setAudioDownloadProgress] = useState<number | null>(null);
  const audioAbortControllerRef = useRef<AbortController | null>(null);

  const formatTime = (seconds: number): string => {
    // Handle invalid or missing time values
    if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds < 0) {
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.dropdown')) {
        setOpenDropdownForSegment(null);
      }
    };

    if (openDropdownForSegment !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdownForSegment]);
  
  const buildTranscriptPayload = (updatedSegments: TranscriptSegment[]) => {
    return {
      transcript: updatedSegments.map((segment, index) => {
        // Use the segment's actual timing if available and valid
        const safeStart = (segment.startTime >= 0 && Number.isFinite(segment.startTime)) ? segment.startTime : index * 5;
        const safeEnd = (segment.endTime >= 0 && Number.isFinite(segment.endTime)) ? segment.endTime : safeStart + 5;

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

  const saveTranscript = useCallback(async (updatedSegments: TranscriptSegment[]) => {
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
  }, [jobId, onTranscriptUpdate]);

  const handleSpeakerNameChange = (oldName: string, newName: string) => {
    setSpeakerColorMap(prev => {
      if (oldName === newName) {
        return prev;
      }
      const next: Record<string, { bg: string; border: string }> = { ...prev };
      if (next[oldName]) {
        const preservedColor = next[oldName];
        delete next[oldName];
        if (!next[newName]) {
          next[newName] = preservedColor;
        }
        return next;
      }
      if (!next[newName]) {
        next[newName] = speakerColorPalette[colorIndexRef.current % speakerColorPalette.length];
        colorIndexRef.current += 1;
      }
      return next;
    });

    // Find the original speaker name of the group currently being edited
    // When a user renames a speaker, they want to rename all segments with that speaker name
    const updatedSegments = segments.map(segment => {
      if (segment.speaker === oldName) {
        return { ...segment, speaker: newName };
      }
      return segment;
    });

    setSegments(updatedSegments);
    setHasChanges(true);
    setEditingSpeakerForSegment(null);
    setOpenDropdownForSegment(null);
  };

  const handleSegmentSpeakerChange = (segmentIds: number[], newName: string) => {
    setSpeakerColorMap(prev => {
      if (prev[newName]) {
        return prev;
      }
      const next: Record<string, { bg: string; border: string }> = { ...prev };
      next[newName] = speakerColorPalette[colorIndexRef.current % speakerColorPalette.length];
      colorIndexRef.current += 1;
      return next;
    });

    const updatedSegments = segments.map(segment => {
      if (segmentIds.includes(segment.id)) {
        // When changing speaker via dropdown, preserve existing doNotMergeWithPrevious value
        // to maintain existing groupings, only change the speaker.
        return { ...segment, speaker: newName };
      }
      return segment;
    });

    setSegments(updatedSegments);
    setHasChanges(true);
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
    setHasChanges(true);
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
    setHasChanges(true);
  };

  const handleSplitSegment = (segmentId: number) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const { startOffset, startContainer } = range;

    if (!startContainer || !startContainer.parentElement?.isContentEditable) {
      return;
    }

    const segmentIndex = segments.findIndex(segment => segment.id === segmentId);
    if (segmentIndex === -1) return;

    const currentSegment = segments[segmentIndex];
    const originalText = currentSegment.text;

    if (startOffset === 0 || startOffset === originalText.length) {
      return;
    }

    const textBefore = originalText.slice(0, startOffset);
    const textAfter = originalText.slice(startOffset);

    const duration = currentSegment.endTime - currentSegment.startTime;
    // Check for valid duration to prevent NaN
    if (isNaN(duration) || !isFinite(duration)) {
      return;
    }

    const splitTime = currentSegment.startTime + (duration * (startOffset / originalText.length));

    // Check for valid splitTime to prevent invalid time values
    if (isNaN(splitTime) || !isFinite(splitTime)) {
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

    setSegments(updatedSegments);
    setHasChanges(true);
  };

  const handleEditClick = (group: TranscriptSegment & { originalSegments: TranscriptSegment[] }) => {
    setEditingSegmentId(group.id);
  };

  const uniqueSpeakers = [...new Set(segments.map(segment => segment.speaker))];

  useEffect(() => {
    const currentSpeakers = Array.from(new Set(segments.map(segment => segment.speaker)));
    setSpeakerColorMap(prev => {
      const next: Record<string, { bg: string; border: string }> = { ...prev };
      let mutated = false;

      currentSpeakers.forEach(speaker => {
        if (!next[speaker]) {
          next[speaker] = speakerColorPalette[colorIndexRef.current % speakerColorPalette.length];
          colorIndexRef.current += 1;
          mutated = true;
        }
      });

      Object.keys(next).forEach(key => {
        if (!currentSpeakers.includes(key)) {
          delete next[key];
          mutated = true;
        }
      });

      return mutated ? next : prev;
    });
  }, [segments, speakerColorPalette]);

  
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
    if (audioAbortControllerRef.current) {
      audioAbortControllerRef.current.abort();
      audioAbortControllerRef.current = null;
    }

    setIsAudioLoading(false);
    setAudioDownloadProgress(null);
    setAudioError(null);
    setAudioUrl(prev => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });

    let isMounted = true;

    const fetchJobDetails = async () => {
      try {
        const response = await apiClient.get(`/jobs/${jobId}`);
        if (!isMounted) {
          return;
        }
        const jobDetails: any = response.data;

        if (jobDetails.timing_info) {
          try {
            const timingData = JSON.parse(jobDetails.timing_info);
            const parsedSegments: TranscriptSegment[] = timingData.map((item: any, index: number) => {
              const startTime = parseFloat(item.start_time);
              const endTime = parseFloat(item.end_time);

              const validStartTime = (!isNaN(startTime) && isFinite(startTime) && startTime >= 0) ? startTime : index * 5;
              const validEndTime = (!isNaN(endTime) && isFinite(endTime) && endTime >= 0) ? endTime : (index + 1) * 5;

              return {
                id: index,
                text: item.text || '',
                startTime: validStartTime,
                endTime: validEndTime,
                speaker: item.speaker || 'Unknown',
                doNotMergeWithPrevious: Boolean(item.do_not_merge_with_previous)
              };
            });
            setSegments(parsedSegments);
            setOriginalTranscript(parsedSegments);
          } catch (error) {
            console.error("Error parsing timing info:", error);
            const fallbackSegments = parseTranscriptFallback(jobDetails.transcript || '');
            setSegments(fallbackSegments);
            setOriginalTranscript(fallbackSegments);
          }
        } else {
          const fallbackSegments = parseTranscriptFallback(jobDetails.transcript || '');
          setSegments(fallbackSegments);
          setOriginalTranscript(fallbackSegments);
        }
      } catch (error) {
        console.error("Error fetching job details:", error);
        if (!isMounted) {
          return;
        }
        setSegments(parseTranscriptFallback(initialTranscript || ''));
        setAudioError("Unable to load job details. Audio playback may not work.");
      }
    };

    fetchJobDetails();

    return () => {
      isMounted = false;
    };
  }, [jobId, initialTranscript]);

  useEffect(() => {
    // This effect runs when audioUrl changes - clean up previous URL
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (audioAbortControllerRef.current) {
        audioAbortControllerRef.current.abort();
        audioAbortControllerRef.current = null;
      }
    };
  }, []);

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

  
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        setEditingSegmentId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (hasChanges) {
          saveTranscript(segments).then(() => {
            setOriginalTranscript([...segments]);
            setHasChanges(false);
          });
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasChanges, segments, originalTranscript, saveTranscript]);

  const handleSpeakerPlay = async (startTime: number, segmentId: number) => {
    if (!audioUrl) {
      await loadAudio(false);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const element = audioRef.current;
    if (!element) {
      return;
    }

    element.currentTime = startTime;
    try {
      await element.play();
      setIsPlaying(true);
      setCurrentSpeakerPlaying(segmentId);
    } catch (err) {
      console.error('Failed to play requested segment.', err);
      setAudioError('Unable to play the selected segment. Try reloading the audio.');
    }
  };

  const handleSpeakerPause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      setCurrentSpeakerPlaying(null);
    }
  };

  const audioLoadPromiseRef = useRef<Promise<void> | null>(null);

  const loadAudio = useCallback(async (autoPlay: boolean = false) => {
    if (audioUrl) {
      if (autoPlay && audioRef.current) {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (err) {
          console.error('Auto-play failed after audio load.', err);
          setAudioError('Audio is ready, but playback was blocked. Press play to start.');
        }
      }
      return;
    }

    if (audioLoadPromiseRef.current) {
      await audioLoadPromiseRef.current;
      if (autoPlay && audioRef.current) {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (err) {
          console.error('Auto-play failed after queued load.', err);
          setAudioError('Audio loaded. Press play to start playback.');
        }
      }
      return;
    }

    const controller = new AbortController();
    audioAbortControllerRef.current = controller;
    setIsAudioLoading(true);
    setAudioDownloadProgress(0);
    setAudioError(null);

    const loadPromise = (async () => {
      try {
        const requestConfig = {
          responseType: 'blob' as const,
          signal: controller.signal,
          onDownloadProgress: (event: ProgressEvent) => {
            if (event.lengthComputable && event.total) {
              const nextProgress = Math.round((event.loaded / event.total) * 100);
              setAudioDownloadProgress(nextProgress);
            }
          },
        } as const;

        const response = await apiClient.get<Blob>(`/jobs/${jobId}/audio`, requestConfig as any);

        if (controller.signal.aborted) {
          return;
        }

        const headers = response.headers as Record<string, string | undefined>;
        const contentType = headers['content-type'] || headers['Content-Type'] || 'audio/mpeg';
        const responseBlob = response.data;
        const audioBlob = responseBlob instanceof Blob && responseBlob.type
          ? responseBlob
          : new Blob([responseBlob], { type: contentType });
        const audioBlobUrl = URL.createObjectURL(audioBlob);
        setAudioUrl(audioBlobUrl);
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
          return;
        }
        console.error('Error fetching audio file:', error);
        setAudioError('Unable to load audio file. Audio playback may not work.');
        setAudioUrl(null);
      } finally {
        audioAbortControllerRef.current = null;
        setAudioDownloadProgress(null);
        setIsAudioLoading(false);
        audioLoadPromiseRef.current = null;
      }
    })();

    audioLoadPromiseRef.current = loadPromise;
    await loadPromise;

    if (autoPlay) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (audioRef.current) {
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch (err) {
          console.error('Auto-play failed after loading audio.', err);
          setAudioError('Audio loaded. Press play to start playback.');
        }
      }
    }
  }, [audioUrl, jobId]);

  const handlePlayPause = useCallback(async () => {
    if (isAudioLoading) {
      return;
    }

    if (!audioUrl) {
      await loadAudio(true);
      return;
    }

    const element = audioRef.current;
    if (!element) {
      return;
    }

    if (element.paused) {
      try {
        await element.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Failed to play audio.', err);
        setAudioError('Unable to play audio automatically.');
      }
    } else {
      element.pause();
      setIsPlaying(false);
    }

    if (element.paused) {
      setCurrentSpeakerPlaying(null);
    }
  }, [audioUrl, isAudioLoading, loadAudio]);

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
    <div className="transcript-editor" ref={editorRef}>
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
          }
          .highlighted-segment {
            animation: highlightFade 5s ease-out;
          }
          @keyframes highlightFade {
            0% {
              background-color: #ffc107 !important;
              transform: translateX(4px) scale(1.02);
            }
            20% {
              background-color: #fff3cd !important;
              transform: translateX(2px) scale(1.01);
            }
            100% {
              background-color: #fff3cd;
              transform: translateX(0) scale(1);
            }
          }
          .dropdown-menu {
            z-index: 1060 !important;
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15) !important;
            border: 1px solid rgba(0, 0, 0, 0.15) !important;
            border-radius: 0.375rem !important;
          }
          .transcript-segment {
            overflow: visible !important;
          }
          .dropdown-toggle {
            position: relative !important;
            z-index: 1000 !important;
          }
          /* Ensure dropdown appears above all segments */
          .dropdown.open .dropdown-menu {
            z-index: 1070 !important;
          }
          /* Fix dropdown item hover states */
          .dropdown-item:hover {
            background-color: #f8f9fa !important;
          }
          /* Better focus states for accessibility */
          .dropdown-item:focus {
            outline: 2px solid #80bdff !important;
            outline-offset: -2px !important;
          }
        `}
      </style>
      {/* Transcript Editor Header */}
      <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-light" style={{ minHeight: '48px' }}>
        <div className="d-flex align-items-center gap-2" style={{ minHeight: '32px' }}>
          <h6 className="mb-0 text-muted d-flex align-items-center" style={{ fontSize: '0.9rem', fontWeight: '500', margin: 0, lineHeight: '1.2' }}>
            <i className="bi bi-file-text me-2" style={{ fontSize: '0.8rem' }}></i>Transcript
          </h6>
          {audioUrl ? (
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
                disabled={!!audioError || isAudioLoading}
                title={isPlaying ? "Pause" : "Play"}
                style={{ height: '28px', width: '28px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {isPlaying ? (
                  <i className="bi bi-pause-fill" style={{ fontSize: '0.7rem' }}></i>
                ) : (
                  <i className="bi bi-play-fill" style={{ fontSize: '0.7rem' }}></i>
                )}
              </button>
            </>
          ) : isAudioLoading ? (
            <span className="text-muted small d-flex align-items-center" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', gap: '0.25rem' }}>
              <span className="spinner-border spinner-border-sm" style={{ width: '0.7rem', height: '0.7rem' }}></span>
              <span>
                Loading audio{typeof audioDownloadProgress === 'number' ? ` ${audioDownloadProgress}%` : '...'}
              </span>
            </span>
          ) : (
            <button
              className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
              onClick={() => loadAudio(true)}
              disabled={isAudioLoading}
              style={{ height: '28px', padding: '0 8px' }}
            >
              <i className="bi bi-cloud-download"></i>
              <span style={{ fontSize: '0.7rem' }}>Load audio</span>
            </button>
          )}
        </div>

        <div className="d-flex align-items-center gap-2" style={{ minHeight: '32px' }}>
          {hasChanges && (
            <small className="text-warning me-2">
              <i className="bi bi-exclamation-circle me-1"></i>Unsaved changes
            </small>
          )}
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={onDownloadTranscript}
            disabled={!onDownloadTranscript || !canDownloadTranscript}
            title="Download transcript"
            style={{ height: '32px', fontSize: '0.75rem', padding: '4px 8px' }}
          >
            <i className="bi bi-download me-1"></i> Download Transcript
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
            style={{ height: '32px', fontSize: '0.75rem', padding: '4px 8px' }}
          >
            <i className="bi bi-arrow-clockwise me-1"></i> Reset
          </button>
          <button
            className="btn btn-sm btn-outline-success"
            onClick={async (event) => {
              // Store button reference safely before async operations
              const button = event.currentTarget as HTMLButtonElement;
              if (!button) return;

              const originalText = button.innerHTML;
              const originalClasses = button.className;

              // Disable button and show loading state
              button.disabled = true;
              button.innerHTML = '<span className="spinner-border spinner-border-sm me-1"></span>Saving...';

              // Save current changes to backend and update original
              try {
                await saveTranscript(segments);
                setOriginalTranscript([...segments]);
                setHasChanges(false);

                // Show success feedback
                button.innerHTML = '<i className="bi bi-check-circle me-1"></i> Saved!';
                button.classList.remove('btn-outline-success');
                button.classList.add('btn-success');

                setTimeout(() => {
                  if (button) {
                    button.innerHTML = originalText;
                    button.className = originalClasses;
                    button.disabled = false;
                  }
                }, 2000);
              } catch (error) {
                console.error('Failed to save transcript:', error);
                // Show error feedback
                button.innerHTML = '<i className="bi bi-exclamation-triangle me-1"></i> Error';
                button.classList.remove('btn-outline-success');
                button.classList.add('btn-danger');

                setTimeout(() => {
                  if (button) {
                    button.innerHTML = originalText;
                    button.className = originalClasses;
                    button.disabled = false;
                  }
                }, 2000);
              }
            }}
            disabled={!hasChanges}
            title="Save current changes"
            style={{ height: '32px', fontSize: '0.75rem', padding: '4px 8px' }}
          >
            <i className="bi bi-save me-1"></i> Save
          </button>
        </div>
      </div>

      {audioError && (
        <div className="alert alert-warning py-1 mb-2">
          <small>{audioError}</small>
        </div>
      )}

      <div className="transcript-container" style={{
        height: 'calc(75vh - 60px)',
        overflowY: 'auto',
        overflowX: 'visible',
        padding: '1rem',
        position: 'relative'
      }}>
        {segments.length === 0 ? (
          <div className="text-center text-muted p-4">
            <div className="spinner-border spinner-border-sm me-2"></div>
            Loading transcript data...
          </div>
        ) : (
          groupedSegments.map((group, index) => {
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

          const assignedColors = speakerColorMap[group.speaker];
          const bgColor = assignedColors?.bg ?? getSpeakerColor(group.speaker);
          const borderColor = assignedColors?.border ?? getSpeakerBorderColor(group.speaker);
          const isCurrentlyPlaying = currentSpeakerPlaying === group.id;
          const isEditing = editingSegmentId === group.id;

          // Check if this segment should be highlighted based on references
          // highlightedSegments are 1-based indices (from transcript segments)
          // group.index + 1 should match the refIndex since groups are rendered in order
          const isHighlighted = highlightedSegments.some(refIndex => (index + 1) === refIndex);
          const isDropdownOpen = openDropdownForSegment === group.id;

          return (
            <div
              key={group.id}
              className={`transcript-segment p-2 mb-2 rounded border ${isEditing ? 'border-primary' : ''} ${isHighlighted ? 'highlighted-segment' : ''}`}
              style={{
                fontSize: '0.9rem',
                backgroundColor: isHighlighted ? '#fff3cd' : bgColor,
                borderColor: isHighlighted ? '#ffc107' : (isEditing ? '#007bff' : borderColor),
                borderLeftWidth: isHighlighted ? '6px' : '3px',
                borderLeftColor: isHighlighted ? '#ffc107' : borderColor,
                borderWidth: isHighlighted ? '2px' : '1px',
                boxShadow: isCurrentlyPlaying ? '0 0 6px rgba(0,0,0,0.15)' : (isHighlighted ? '0 4px 12px rgba(255,193,7,0.4)' : 'none'),
                transform: isHighlighted ? 'translateX(4px) scale(1.02)' : undefined,
                transition: 'all 0.3s ease',
                position: 'relative',
                zIndex: isDropdownOpen ? 2000 : (isHighlighted ? 10 : (editingSpeakerForSegment === group.id ? 15 : 1)),
                overflow: 'visible'
              }}
            >
              <div className="segment-header d-flex justify-content-between align-items-center mb-2">
                <div className="d-flex align-items-center gap-2 flex-grow-1">
                  <span className={`badge ${isHighlighted ? 'bg-warning' : 'bg-primary'} me-2`} style={{
                    fontSize: '0.75rem',
                    minWidth: '30px',
                    textAlign: 'center',
                    animation: isHighlighted ? 'pulse 1.5s infinite' : 'none'
                  }}>
                    {index + 1}
                  </span>
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
                            setOpenDropdownForSegment(null);
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
                    <div className="dropdown position-relative" style={{zIndex: 1050}}>
                      <button
                        className="btn btn-sm dropdown-toggle py-0"
                        type="button"
                        onClick={() => setOpenDropdownForSegment(openDropdownForSegment === group.id ? null : group.id)}
                        aria-expanded={openDropdownForSegment === group.id}
                        style={{
                          backgroundColor: borderColor,
                          color: '#000',
                          fontSize: '0.8rem',
                          padding: '2px 8px',
                          position: 'relative',
                          zIndex: 1051
                        }}
                      >
                        {group.speaker}
                      </button>
                      {openDropdownForSegment === group.id && (
                        <ul
                          className="dropdown-menu show"
                          style={{
                            zIndex: 1080,
                            position: 'absolute',
                            transform: 'translateY(2px)',
                            minWidth: '120px',
                            marginTop: '0.25rem',
                            boxShadow: '0 0.5rem 1rem rgba(0, 0, 0, 0.15)',
                            border: '1px solid rgba(0, 0, 0, 0.15)',
                            borderRadius: '0.375rem',
                            padding: '0.5rem 0'
                          }}
                        >
                        {uniqueSpeakers.map(speaker => (
                          <li key={speaker}>
                            <button
                              className="dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSegmentSpeakerChange(group.originalSegments.map(s => s.id), speaker);
                                setOpenDropdownForSegment(null);
                              }}
                              style={{
                                padding: '0.25rem 1rem',
                                fontSize: '0.875rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {speaker}
                            </button>
                          </li>
                        ))}
                        <li><hr className="dropdown-divider" style={{margin: '0.25rem 0'}} /></li>
                        <li>
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingSpeakerForSegment(group.id);
                              setOpenDropdownForSegment(null);
                            }}
                            style={{
                              padding: '0.25rem 1rem',
                              fontSize: '0.875rem',
                              whiteSpace: 'nowrap',
                              fontWeight: '500'
                            }}
                          >
                            Rename
                          </button>
                        </li>
                      </ul>
                      )}
                    </div>
                  )}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {formatTime(group.startTime)} - {formatTime(group.endTime)}
                  </small>
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
                      onClick={() => {
                        if (isCurrentlyPlaying) {
                          handleSpeakerPause();
                        } else {
                          void handleSpeakerPlay(group.startTime, group.id);
                        }
                      }}
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
                  // Always process the edit when leaving contentEditable
                  const editedText = e.currentTarget.innerText;
                  const originalText = group.text;

                  // Only update if text actually changed
                  if (originalText !== editedText) {
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
                  }

                  setEditingSegmentId(null);
                }}
                onClick={() => !isEditing && handleEditClick(group)}
              >
                {group.text}
              </div>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
};
