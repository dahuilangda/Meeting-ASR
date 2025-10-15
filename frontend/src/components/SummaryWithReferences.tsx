import React, { useState, useEffect } from 'react';
import { MarkdownViewer } from './MarkdownViewer';

interface SummaryData {
  formatted_content: string;
  structured_data: {
    overview?: {
      content: string;
      references: number[];
    };
    key_discussions?: Array<{
      topic: string;
      summary: string;
      references: number[];
    }>;
    decisions?: Array<{
      decision: string;
      responsible_party: string;
      references: number[];
    }>;
    action_items?: Array<{
      action: string;
      owner: string;
      deadline?: string;
      references: number[];
    }>;
    unresolved_issues?: Array<{
      issue: string;
      references: number[];
    }>;
  };
}

interface SummaryWithReferencesProps {
  summary: string | null;
  transcriptSegments: Array<{
    index: number;
    speaker: string;
    text: string;
    start_time: number;
    end_time: number;
  }>;
  onSegmentClick?: (segmentIndex: number) => void;
}

export const SummaryWithReferences: React.FC<SummaryWithReferencesProps> = ({
  summary,
  transcriptSegments,
  onSegmentClick
}) => {
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  useEffect(() => {
    if (summary) {
      try {
        const parsed = JSON.parse(summary);
        setSummaryData(parsed);
        setEditedContent(parsed.formatted_content || '');
      } catch (error) {
        // Fallback for old format summaries
        setSummaryData({
          formatted_content: summary,
          structured_data: {}
        });
        setEditedContent(summary);
      }
    }
  }, [summary]);

  useEffect(() => {
    // Add click handlers for transcript references
    const handleReferenceClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('transcript-ref')) {
        e.preventDefault();
        const segmentNumber = parseInt(target.getAttribute('data-segment') || '0');
        if (onSegmentClick) {
          onSegmentClick(segmentNumber);
        }
      }
    };

    document.addEventListener('click', handleReferenceClick);
    return () => {
      document.removeEventListener('click', handleReferenceClick);
    };
  }, [onSegmentClick]);

  const handleSave = () => {
    // Here you would typically save the edited content
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (summaryData) {
      setEditedContent(summaryData.formatted_content);
    }
    setIsEditing(false);
  };

  if (!summary) {
    return (
      <div className="alert alert-info">
        No summary generated yet. Click the Generate Summary button to create one.
      </div>
    );
  }

  return (
    <div className="summary-with-references">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="card-title mb-0">Meeting Summary</h5>
        {!isEditing && (
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setIsEditing(true)}
          >
            <i className="bi bi-pencil me-1"></i> Edit Summary
          </button>
        )}
      </div>

      {isEditing ? (
        <div>
          <div className="mb-3">
            <textarea
              className="form-control"
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              rows={15}
              style={{ fontSize: '0.9rem' }}
            />
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-success btn-sm" onClick={handleSave}>
              <i className="bi bi-save me-1"></i> Save
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
              <i className="bi bi-x me-1"></i> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="border rounded p-3 bg-light" style={{ minHeight: '300px' }}>
          <style>
            {`
              .transcript-ref {
                color: #007bff;
                text-decoration: none;
                background-color: #e7f3ff;
                padding: 1px 4px;
                border-radius: 3px;
                font-weight: 500;
                cursor: pointer;
              }
              .transcript-ref:hover {
                background-color: #cce5ff;
                text-decoration: underline;
              }
            `}
          </style>
          <div dangerouslySetInnerHTML={{ __html: editedContent }} />
        </div>
      )}

      {summaryData?.structured_data && (
        <div className="mt-4">
          <h6>Quick Reference Index</h6>
          <div className="row">
            {transcriptSegments.slice(0, 20).map((segment) => (
              <div key={segment.index} className="col-6 col-md-4 mb-2">
                <small className="text-muted">
                  <a
                    href="#"
                    className="transcript-ref"
                    data-segment={segment.index}
                    style={{ fontSize: '0.8rem' }}
                  >
                    [{segment.index}]
                  </a>
                  {' '}
                  {segment.speaker}: {segment.text.substring(0, 50)}...
                </small>
              </div>
            ))}
          </div>
          {transcriptSegments.length > 20 && (
            <small className="text-muted">
              ... and {transcriptSegments.length - 20} more segments
            </small>
          )}
        </div>
      )}
    </div>
  );
};