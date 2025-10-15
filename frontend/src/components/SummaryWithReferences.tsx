import React, { useState, useEffect, useCallback } from 'react';
import MarkdownEditor from '@uiw/react-markdown-editor';

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
  onSegmentClick?: (segmentIndex: number | number[]) => void;
}

export const SummaryWithReferences: React.FC<SummaryWithReferencesProps> = ({
  summary,
  transcriptSegments,
  onSegmentClick
}) => {
  const [, setSummaryData] = useState<SummaryData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalContent, setOriginalContent] = useState('');

  useEffect(() => {
    if (summary) {
      try {
        const parsed = JSON.parse(summary);
        console.log('Parsed summary data:', parsed); // Debug log
        setSummaryData(parsed);
        // Only use formatted_content if it exists and is different from the raw summary
        const formattedContent = parsed.formatted_content || '';
        if (formattedContent && formattedContent.trim()) {
          // Process the content to handle HTML references properly
          let processedContent = formattedContent
            .replace(/<a href="#" class="transcript-ref" data-segment="(\d+)">\[(\d+)\]<\/a>/g,
              '<span class="transcript-ref" data-segment="$1">[$2]</span>')
            .replace(/<a href="#" class="transcript-ref" data-segment="(\d+)" data-range="(\d+-\d+)">\[(\d+-\d+)\]<\/a>/g,
              '<span class="transcript-ref" data-segment="$1" data-range="$2">[$3]</span>');

          // Better markdown to HTML conversion
          processedContent = processedContent
            // Headers
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            // Bold text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Line breaks (double newlines become paragraph breaks)
            .replace(/\n\n+/g, '</p><p>')
            // Single newlines become line breaks within paragraphs
            .replace(/\n/g, '<br>')
            // Lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');

          // Wrap in paragraph if not starting with HTML block
          if (!processedContent.startsWith('<h') && !processedContent.startsWith('<ul>')) {
            processedContent = '<p>' + processedContent + '</p>';
          }

          setEditedContent(processedContent);
          setOriginalContent(processedContent);
        } else {
          // Fallback: if no formatted content, create a simple message
          const fallbackContent = 'No formatted summary available. Please generate a new summary.';
          setEditedContent(fallbackContent);
          setOriginalContent(fallbackContent);
        }
      } catch (error) {
        console.error('Error parsing summary:', error);
        // Fallback for old format summaries
        setSummaryData({
          formatted_content: summary,
          structured_data: {}
        });
        setEditedContent(summary);
      }
    }
  }, [summary]);

  
  const handleSave = useCallback(() => {
    // Here you would typically save the edited content
    setOriginalContent(editedContent);
    setHasUnsavedChanges(false);
    setIsEditing(false);
  }, [editedContent]);

  const handleCancel = useCallback(() => {
    if (originalContent) {
      setEditedContent(originalContent);
    }
    setHasUnsavedChanges(false);
    setIsEditing(false);
  }, [originalContent]);

  // Handle content change with unsaved changes tracking
  const handleContentChange = (value: string) => {
    setEditedContent(value || '');
    if (value !== originalContent) {
      setHasUnsavedChanges(true);
    } else {
      setHasUnsavedChanges(false);
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing) {
        // Ctrl+S or Cmd+S to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          handleSave();
        }
        // Escape to cancel
        if (e.key === 'Escape') {
          handleCancel();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, editedContent, originalContent, handleSave, handleCancel]);

  // Warn user before leaving if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  
  if (!summary) {
    return (
      <div className="alert alert-info">
        No summary generated yet. Click the Generate Summary button to create one.
      </div>
    );
  }

  return (
    <div className="summary-with-references">
      <style>
        {`
          .w-md-editor {
            background-color: white;
          }
          .w-md-editor.w-md-editor-focus {
            border-color: #86b7fe;
            box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);
          }
          .w-md-editor-text-container,
          .w-md-editor-text {
            font-family: Monaco, Menlo, "Ubuntu Mono", monospace;
            font-size: 0.9rem;
            line-height: 1.5;
          }
          .w-md-editor-text-input,
          .w-md-editor-text-input:focus {
            border: none;
            outline: none;
            box-shadow: none;
          }
          .w-md-editor-preview {
            background-color: #f8f9fa;
            padding: 1rem;
          }
          .w-md-editor-preview h1,
          .w-md-editor-preview h2,
          .w-md-editor-preview h3 {
            color: #2c3e50;
            margin-top: 1rem;
            margin-bottom: 0.5rem;
          }
          .w-md-editor-preview h2 {
            border-bottom: 2px solid #3498db;
            padding-bottom: 0.3rem;
          }
          .w-md-editor-preview h3 {
            border-bottom: 1px solid #bdc3c7;
            padding-bottom: 0.2rem;
          }
          .w-md-editor-preview strong {
            color: #2c3e50;
            font-weight: 600;
          }
          .w-md-editor-preview p {
            margin-bottom: 1rem;
            line-height: 1.6;
          }
          .w-md-editor-preview ul,
          .w-md-editor-preview ol {
            margin-bottom: 1rem;
            padding-left: 1.5rem;
          }
          .w-md-editor-preview li {
            margin-bottom: 0.3rem;
          }
          .w-md-editor-toolbar {
            border-bottom: 1px solid #dee2e6;
            background-color: #f8f9fa;
          }
          .w-md-editor-toolbar li button {
            color: #495057;
          }
          .w-md-editor-toolbar li button:hover {
            background-color: #e9ecef;
            color: #212529;
          }
          .w-md-editor-toolbar li button.active {
            background-color: #007bff;
            color: white;
          }
        `}
      </style>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-3">
          {!isEditing && (
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setIsEditing(true)}
            >
              <i className="bi bi-pencil me-1"></i> Edit Meeting Minutes
            </button>
          )}
          {hasUnsavedChanges && (
            <div className="text-warning small">
              <i className="bi bi-exclamation-triangle me-1"></i>
              You have unsaved changes
            </div>
          )}
        </div>
      </div>

      {isEditing ? (
        <div>
          <div className="mb-3">
            <div style={{ border: '1px solid #ced4da', borderRadius: '0.375rem' }}>
              <MarkdownEditor
                value={editedContent}
                onChange={handleContentChange}
                height="500px"
                enableScroll={true}
                visible={false}
                enablePreview={false}
                placeholder="Edit meeting minutes here...

Tips:
- Use ## to create headings
- Use **bold** to emphasize points
- Use - to create lists
- Reference format: [paragraph number] will be automatically converted to clickable links"
                data-color-mode="light"
                autoFocus={false}
              />
            </div>
          </div>
          <div className="d-flex justify-content-between align-items-center">
            <div className="d-flex gap-2">
              <button className="btn btn-success btn-sm" onClick={handleSave}>
                <i className="bi bi-save me-1"></i> Save
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={handleCancel}>
                <i className="bi bi-x me-1"></i> Cancel
              </button>
            </div>
            <div className="text-muted small">
              <i className="bi bi-info-circle me-1"></i>
              Markdown format supported • Auto-save reminder
            </div>
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
                display: inline-block;
              }
              .transcript-ref:hover {
                background-color: #cce5ff;
                text-decoration: underline;
              }
              h1, h2, h3, h4, h5, h6 {
                margin-top: 1.5rem;
                margin-bottom: 1rem;
              }
              h2 {
                font-size: 1.5rem;
                font-weight: 600;
                color: #2c3e50;
                border-bottom: 2px solid #3498db;
                padding-bottom: 0.5rem;
              }
              h3 {
                font-size: 1.25rem;
                font-weight: 600;
                color: #34495e;
                border-bottom: 1px solid #bdc3c7;
                padding-bottom: 0.3rem;
              }
              h4 {
                font-size: 1.1rem;
                font-weight: 600;
                color: #34495e;
              }
              p {
                margin-bottom: 1rem;
                line-height: 1.6;
              }
              ul, ol {
                margin-bottom: 1rem;
                padding-left: 1.5rem;
              }
              li {
                margin-bottom: 0.5rem;
              }
              strong {
                color: #2c3e50;
              }
              .markdown-content {
                font-size: 0.9rem;
              }
            `}
          </style>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: editedContent }}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.classList.contains('transcript-ref')) {
                e.preventDefault();
                const segmentNumber = parseInt(target.getAttribute('data-segment') || '0');
                const rangeAttr = target.getAttribute('data-range');

                console.log('Transcript reference clicked:', { segmentNumber, rangeAttr }); // Debug log

                if (onSegmentClick) {
                  if (rangeAttr) {
                    // Handle range references like [2-3]
                    const [start, end] = rangeAttr.split('-').map(Number);
                    const range = [];
                    for (let i = start; i <= end; i++) {
                      range.push(i);
                    }
                    console.log('Calling onSegmentClick with range:', range);
                    onSegmentClick(range);
                  } else {
                    // Handle single reference like [1]
                    console.log('Calling onSegmentClick with single segment:', segmentNumber);
                    onSegmentClick(segmentNumber);
                  }
                }
              }
            }}
          />
        </div>
      )}

          </div>
  );
};