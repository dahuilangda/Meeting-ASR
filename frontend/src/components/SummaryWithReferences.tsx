import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api';

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
  jobId: number;
  transcriptSegments: Array<{
    index: number;
    speaker: string;
    text: string;
    start_time: number;
    end_time: number;
  }>;
  onSegmentClick?: (segmentIndex: number | number[]) => void;
  onSummaryUpdate?: (updatedSummary: string) => void;
}

export const SummaryWithReferences: React.FC<SummaryWithReferencesProps> = ({
  summary,
  jobId,
  transcriptSegments,
  onSegmentClick,
  onSummaryUpdate
}) => {
  const [, setSummaryData] = useState<SummaryData | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

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
              '[[$2]]')
            .replace(/<a href="#" class="transcript-ref" data-segment="(\d+)" data-range="(\d+-\d+)">\[(\d+-\d+)\]<\/a>/g,
              '[[$3]]');

          // Convert HTML to markdown format for editing
          processedContent = processedContent
            // Headers
            .replace(/<h[1-6]>(.+?)<\/h[1-6]>/gi, (match: string, content: string) => {
              const level = match.match(/h(\d)/)?.[1] || '2';
              return '#'.repeat(parseInt(level)) + ' ' + content + '\n\n';
            })
            // Bold text
            .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
            // Line breaks and paragraphs
            .replace(/<\/p>/g, '\n\n')
            .replace(/<p>/g, '')
            // Lists
            .replace(/<ul>/gi, '')
            .replace(/<\/ul>/gi, '\n')
            .replace(/<li>(.+?)<\/li>/gi, '- $1\n')
            // Line breaks
            .replace(/<br\s*\/?>/gi, '\n')
            // Clean up extra whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();

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
        // Fallback for old format summaries - convert to markdown
        setSummaryData({
          formatted_content: summary,
          structured_data: {}
        });
        setEditedContent(summary);
        setOriginalContent(summary);
      }
    }
  }, [summary]);

  // Handle reference click
  const handleReferenceClick = (refAttr: string) => {
    console.log('Transcript reference clicked:', { refAttr }); // Debug log
    if (onSegmentClick) {
      if (refAttr.includes('-')) {
        // Handle range references like [[2-3]]
        const [start, end] = refAttr.split('-').map(Number);
        const range = [];
        for (let i = start; i <= end; i++) {
          range.push(i);
        }
        console.log('Calling onSegmentClick with range:', range);
        onSegmentClick(range);
      } else {
        // Handle single reference like [[1]]
        console.log('Calling onSegmentClick with single segment:', parseInt(refAttr));
        onSegmentClick(parseInt(refAttr));
      }
    }
  };

  // Convert markdown to HTML for WYSIWYG editor
  const getHtmlContent = useCallback(() => {
    let html = editedContent
      // Handle headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Handle bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Handle italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Handle lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$1. $2</li>')
      // Handle transcript references
      .replace(/\[\[(\d+(?:-\d+)?)\]\]/g, '<span class="transcript-ref" data-ref="$1">$1</span>')
      // Handle line breaks
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap in paragraphs if not starting with HTML block
    if (!html.startsWith('<h') && !html.startsWith('<li>') && !html.startsWith('<ul>') && !html.startsWith('<ol>')) {
      html = '<p>' + html + '</p>';
    }

    // Wrap consecutive list items in proper list tags
    html = html.replace(/(<li>.*?<\/li>)/gs, (match) => {
      if (match.includes('. ')) {
        return '<ol>' + match + '</ol>';
      } else {
        return '<ul>' + match + '</ul>';
      }
    });

    return html;
  }, [editedContent]);

  // Convert HTML back to markdown
  const htmlToMarkdown = useCallback((html: string): string => {
    let markdown = html
      // Handle headers
      .replace(/<h1>(.+?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2>(.+?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3>(.+?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4>(.+?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5>(.+?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6>(.+?)<\/h6>/gi, '###### $1\n\n')
      // Handle bold
      .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
      // Handle italic
      .replace(/<em>(.+?)<\/em>/gi, '*$1*')
      // Handle lists
      .replace(/<ol>(.*?)<\/ol>/gis, (match, content) => {
        return content.replace(/<li>(.+?)<\/li>/gi, '$1\n').replace(/^\d+\.\s/, '');
      })
      .replace(/<ul>(.*?)<\/ul>/gis, (match, content) => {
        return content.replace(/<li>(.+?)<\/li>/gi, '- $1\n');
      })
      // Handle transcript references
      .replace(/<span class="transcript-ref"[^>]*data-ref="([^"]*)"[^>]*>([^<]+)<\/span>/gi, '[[$1]]')
      // Handle paragraphs and line breaks
      .replace(/<\/p>/g, '\n\n')
      .replace(/<p>/g, '')
      .replace(/<br\s*\/?>/g, '\n')
      // Clean up extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return markdown;
  }, []);

  // Handle WYSIWYG input with auto-save
  const handleWysiwygInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    e.persist();
    // Only update state if not currently editing to avoid losing focus
    if (!isEditing) {
      const target = e.currentTarget;
      const htmlContent = target.innerHTML;
      const markdownContent = htmlToMarkdown(htmlContent);

      setEditedContent(markdownContent);
      setHasChanges(markdownContent !== originalContent);
    }
  }, [htmlToMarkdown, originalContent, isEditing]);

  // Handle focus to track editing state
  const handleEditorFocus = useCallback(() => {
    setIsEditing(true);
  }, []);

  // Handle blur to save content
  const handleEditorBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const htmlContent = target.innerHTML;
    const markdownContent = htmlToMarkdown(htmlContent);

    setEditedContent(markdownContent);
    setHasChanges(markdownContent !== originalContent);
    setIsEditing(false);
  }, [htmlToMarkdown, originalContent]);

  // Insert formatting at cursor position
  const insertFormatting = useCallback((before: string, after: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const selectedText = range.toString() || 'text';

      // Create a new text node with the formatted content
      const textNode = document.createTextNode(before + selectedText + after);

      // Delete the selected content and insert the new text node
      range.deleteContents();
      range.insertNode(textNode);

      // Move cursor to the end of the inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);

      // Auto-save after formatting
      const wysiwygEditor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
      if (wysiwygEditor) {
        const htmlContent = wysiwygEditor.innerHTML;
        const markdownContent = htmlToMarkdown(htmlContent);
        setEditedContent(markdownContent);
        setHasChanges(markdownContent !== originalContent);
      }
    }
  }, [htmlToMarkdown, originalContent]);

  // Insert transcript reference
  const insertReference = useCallback(() => {
    const segmentNumber = prompt('Enter transcript segment number (or range like 2-3):');
    if (segmentNumber) {
      insertFormatting(`[[${segmentNumber}]]`, '');
    }
  }, [insertFormatting]);

  // Save summary function
  const saveSummary = useCallback(async () => {
    try {
      // Convert markdown content back to the original format expected by the backend
      const baseSummaryData = summary ? JSON.parse(summary) : {};
      const updatedSummaryData = {
        ...baseSummaryData,
        formatted_content: editedContent
      };

      const requestPayload = {
        summary: JSON.stringify(updatedSummaryData)
      };

      await apiClient.post(`/jobs/${jobId}/update_summary`, requestPayload, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (onSummaryUpdate) {
        onSummaryUpdate(JSON.stringify(updatedSummaryData));
      }

      setOriginalContent(editedContent);
      setHasChanges(false);

      // Force re-render after successful save
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = getHtmlContent();
        }
      }, 100);

      return true;
    } catch (error) {
      console.error('Error saving summary:', error);
      return false;
    }
  }, [jobId, summary, editedContent, onSummaryUpdate, getHtmlContent]);

  // Initialize editor content when summary changes or when editor is ready
  useEffect(() => {
    if (editorRef.current && editedContent) {
      const htmlContent = getHtmlContent();
      editorRef.current.innerHTML = htmlContent;
      setIsInitialized(true);
    }
  }, [editedContent, getHtmlContent]);

  // Also ensure content is rendered when component mounts or ref is set
  useEffect(() => {
    if (editorRef.current && editedContent && !isInitialized) {
      const htmlContent = getHtmlContent();
      editorRef.current.innerHTML = htmlContent;
      setIsInitialized(true);
    }
  }, [editorRef, editedContent, getHtmlContent, isInitialized]);

  // Prevent content from being overwritten by React's reconciliation
  useEffect(() => {
    if (editorRef.current && isInitialized && editedContent && !isEditing) {
      const htmlContent = getHtmlContent();
      if (editorRef.current.innerHTML !== htmlContent) {
        editorRef.current.innerHTML = htmlContent;
      }
    }
  }, [editedContent, getHtmlContent, isInitialized, isEditing]);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (hasChanges) {
          saveSummary().then((success) => {
            if (success) {
              console.log('Summary saved successfully');
            }
          });
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasChanges, editedContent, originalContent, saveSummary]);


  if (!summary) {
    return (
      <div className="alert alert-info">
        No summary generated yet. Click the Generate Summary button to create one.
      </div>
    );
  }

  return (
    <div className="summary-with-references" style={{height: '100%', display: 'flex', flexDirection: 'column', padding: '0'}}>

      {/* Editor Header with Save Button */}
      <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-light" style={{ minHeight: '48px' }}>
        <h6 className="mb-0 text-muted d-flex align-items-center" style={{ fontSize: '0.9rem', fontWeight: '500', margin: 0, lineHeight: '1.2' }}>
          <i className="bi bi-journal-text me-2" style={{ fontSize: '0.8rem' }}></i>Meeting Summary
        </h6>
        <div className="d-flex align-items-center gap-2" style={{ minHeight: '32px' }}>
          {hasChanges && (
            <small className="text-warning me-2">
              <i className="bi bi-exclamation-circle me-1"></i>Unsaved changes
            </small>
          )}
          <button
            className={`btn btn-sm ${hasChanges ? 'btn-outline-success' : 'btn-outline-secondary'}`}
            onClick={async (event) => {
              if (!hasChanges) return;

              const button = event.currentTarget as HTMLButtonElement;
              const originalText = button.innerHTML;
              button.innerHTML = '<span className="spinner-border spinner-border-sm me-1"></span>Saving...';
              button.disabled = true;

              const success = await saveSummary();

              if (success) {
                button.innerHTML = '<i className="bi bi-check-circle me-1"></i> Saved!';
                button.classList.remove('btn-outline-success');
                button.classList.add('btn-success');
                setTimeout(() => {
                  button.innerHTML = originalText;
                  button.classList.remove('btn-success');
                  button.classList.add('btn-outline-success');
                  button.disabled = false;
                }, 2000);
              } else {
                button.innerHTML = '<i className="bi bi-exclamation-triangle me-1"></i> Error';
                button.classList.remove('btn-outline-success');
                button.classList.add('btn-danger');
                setTimeout(() => {
                  button.innerHTML = originalText;
                  button.classList.remove('btn-danger');
                  button.classList.add('btn-outline-success');
                  button.disabled = false;
                }, 2000);
              }
            }}
            disabled={!hasChanges}
            title="Save summary changes"
            style={{ height: '32px', fontSize: '0.75rem', padding: '4px 8px' }}
          >
            <i className="bi bi-save me-1"></i> Save
          </button>
        </div>
      </div>

      <div className="summary-container" style={{ height: 'calc(75vh - 60px)', overflowY: 'auto' }}>
        <style>
          {`
            .wysiwyg-editor {
              min-height: 400px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 0.9rem;
              line-height: 1.6;
              color: #333;
              outline: none;
              border: none;
              padding: 16px;
            }
            .wysiwyg-editor:focus {
              outline: 2px solid #007bff;
              outline-offset: -2px;
            }
            .transcript-ref {
              color: #007bff;
              text-decoration: none;
              background-color: #e7f3ff;
              padding: 2px 6px;
              border-radius: 4px;
              font-weight: 500;
              cursor: pointer;
              display: inline-block;
              transition: all 0.2s ease;
              margin: 0 2px;
            }
            .transcript-ref:hover {
              background-color: #cce5ff;
              text-decoration: underline;
              transform: translateY(-1px);
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 1.5rem;
              margin-bottom: 1rem;
              color: #2c3e50;
            }
            h2 {
              font-size: 1.5rem;
              font-weight: 600;
              border-bottom: 2px solid #3498db;
              padding-bottom: 0.5rem;
            }
            h3 {
              font-size: 1.25rem;
              font-weight: 600;
              border-bottom: 1px solid #bdc3c7;
              padding-bottom: 0.3rem;
            }
            h4 {
              font-size: 1.1rem;
              font-weight: 600;
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
              font-weight: 600;
            }
            .editor-toolbar {
              position: sticky;
              top: 0;
              z-index: 10;
              background: white;
              border-bottom: 1px solid #dee2e6;
              padding: 8px 16px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .toolbar-btn {
              border: 1px solid #dee2e6;
              background: white;
              padding: 6px 10px;
              margin: 0 2px;
              border-radius: 4px;
              cursor: pointer;
              color: #495057;
              font-size: 0.8rem;
              transition: all 0.2s ease;
            }
            .toolbar-btn:hover {
              background-color: #f8f9fa;
              border-color: #adb5bd;
              color: #212529;
              transform: translateY(-1px);
            }
            .toolbar-btn.active {
              background-color: #007bff;
              border-color: #007bff;
              color: white;
            }
          `}
        </style>

        {/* Editor Toolbar */}
        <div className="editor-toolbar">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button className="toolbar-btn" onClick={() => insertFormatting('**', '**')} title="Bold">
              <i className="bi bi-type-bold"></i>
            </button>
            <button className="toolbar-btn" onClick={() => insertFormatting('*', '*')} title="Italic">
              <i className="bi bi-type-italic"></i>
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button className="toolbar-btn" onClick={() => insertFormatting('## ', '')} title="Heading 2">
              H2
            </button>
            <button className="toolbar-btn" onClick={() => insertFormatting('### ', '')} title="Heading 3">
              H3
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button className="toolbar-btn" onClick={() => insertFormatting('- ', '')} title="Bullet List">
              <i className="bi bi-list-ul"></i>
            </button>
            <button className="toolbar-btn" onClick={() => insertFormatting('1. ', '')} title="Numbered List">
              <i className="bi bi-list-ol"></i>
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button className="toolbar-btn" onClick={() => insertReference()} title="Insert Transcript Reference" style={{background: '#007bff', color: 'white', borderColor: '#007bff'}}>
              <i className="bi bi-link-45deg"></i> Ref
            </button>
          </div>
        </div>

        {/* Editor Content */}
        <div
          ref={editorRef}
          className="wysiwyg-editor"
          contentEditable
          suppressContentEditableWarning={true}
          onInput={handleWysiwygInput}
          onFocus={handleEditorFocus}
          onBlur={handleEditorBlur}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('transcript-ref')) {
              e.preventDefault();
              const refAttr = target.getAttribute('data-ref') || '0';
              handleReferenceClick(refAttr);
            }
          }}
        />
      </div>

    </div>
  );
};