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

  // Check if selection is already formatted with the given tag
  const isSelectionFormatted = useCallback((range: Range, tagName: string): boolean => {
    // Check if any part of the selection is already wrapped in the specified tag
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // Check start container
    let currentElement = startContainer.nodeType === Node.TEXT_NODE
      ? startContainer.parentElement
      : startContainer as Element;

    while (currentElement && currentElement !== document.body) {
      if (currentElement.tagName === tagName) {
        return true;
      }
      currentElement = currentElement.parentElement;
    }

    // Check end container if different
    if (startContainer !== endContainer) {
      currentElement = endContainer.nodeType === Node.TEXT_NODE
        ? endContainer.parentElement
        : endContainer as Element;

      while (currentElement && currentElement !== document.body) {
        if (currentElement.tagName === tagName) {
          return true;
        }
        currentElement = currentElement.parentElement;
      }
    }

    return false;
  }, []);

  // Insert formatting at cursor position
  const insertFormatting = useCallback((before: string, after: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = range.toString() || '';

    // Create a temporary div to hold the formatted HTML
    const tempDiv = document.createElement('div');
    let formattedHtml = '';

    if (before === '**' && after === '**') {
      // Bold formatting
      if (selectedText) {
        // Check if text is already bold
        if (isSelectionFormatted(range, 'STRONG')) {
          // Remove bold formatting by extracting text content
          formattedHtml = selectedText;
        } else {
          // Add bold formatting
          formattedHtml = `<strong>${selectedText}</strong>`;
        }
      } else {
        // Insert placeholder text for bold when no selection
        formattedHtml = '<strong>bold text</strong>';
      }
    } else if (before === '*' && after === '*') {
      // Italic formatting
      if (selectedText) {
        // Check if text is already italic
        if (isSelectionFormatted(range, 'EM')) {
          // Remove italic formatting by extracting text content
          formattedHtml = selectedText;
        } else {
          // Add italic formatting
          formattedHtml = `<em>${selectedText}</em>`;
        }
      } else {
        // Insert placeholder text for italic when no selection
        formattedHtml = '<em>italic text</em>';
      }
    } else if (before.startsWith('#')) {
      // Header formatting
      const headerLevel = before.length;
      formattedHtml = `<h${headerLevel}>${selectedText || 'heading'}</h${headerLevel}>`;
    } else if (before === '- ') {
      // Bullet list
      formattedHtml = `<ul><li>${selectedText || 'list item'}</li></ul>`;
    } else if (before === '1. ') {
      // Numbered list
      formattedHtml = `<ol><li>${selectedText || 'list item'}</li></ol>`;
    } else {
      // Other formatting
      formattedHtml = selectedText || 'text';
    }

    tempDiv.innerHTML = formattedHtml;

    // Insert the formatted content
    try {
      range.deleteContents();

      // Insert all child nodes from tempDiv
      const fragment = document.createDocumentFragment();
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      range.insertNode(fragment);

      // Move cursor appropriately - with safety checks
      if (!selectedText && ((before === '**' && after === '**') || (before === '*' && after === '*'))) {
        // For bold/italic with no selection, select the placeholder text
        const firstChild = fragment.firstChild;
        if (firstChild && firstChild.parentNode) {
          range.selectNodeContents(firstChild);
        }
      } else {
        // Move cursor to the end of the inserted content
        const lastChild = fragment.lastChild;
        if (lastChild && lastChild.parentNode) {
          try {
            range.setEndAfter(lastChild);
            range.collapse(false); // Collapse to end
          } catch (error) {
            // Fallback: use setStartAfter if setEndAfter fails
            try {
              range.setStartAfter(lastChild);
              range.collapse(true);
            } catch (fallbackError) {
              // Final fallback: place cursor at the end of the editor
              const editor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
              if (editor) {
                const newRange = document.createRange();
                newRange.selectNodeContents(editor);
                newRange.collapse(false);
                selection.removeAllRanges();
                selection.addRange(newRange);
                return;
              }
            }
          }
        }
      }

      // Ensure range is valid before adding to selection
      if (range.startContainer && range.endContainer) {
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Trigger input event to update the editor content
      const wysiwygEditor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
      if (wysiwygEditor) {
        // Force a content update
        const inputEvent = new Event('input', { bubbles: true });
        wysiwygEditor.dispatchEvent(inputEvent);
      }
    } catch (error) {
      console.error('Error inserting formatting:', error);
      // Fallback: try to insert plain text using modern methods
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const textNode = document.createTextNode(formattedHtml.replace(/<[^>]*>/g, ''));
        try {
          range.deleteContents();
          range.insertNode(textNode);
          range.selectNodeContents(textNode);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (fallbackError) {
          console.error('Error inserting fallback text:', fallbackError);
        }
      }
    }
  }, [isSelectionFormatted]);

  // Check toolbar button states based on current selection
  const checkToolbarStates = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const isBold = isSelectionFormatted(range, 'STRONG');
      const isItalic = isSelectionFormatted(range, 'EM');

      // Update toolbar button states
      const boldBtn = document.querySelector('.toolbar-btn[data-format="bold"]');
      const italicBtn = document.querySelector('.toolbar-btn[data-format="italic"]');

      if (boldBtn) {
        if (isBold) {
          boldBtn.classList.add('active');
        } else {
          boldBtn.classList.remove('active');
        }
      }

      if (italicBtn) {
        if (isItalic) {
          italicBtn.classList.add('active');
        } else {
          italicBtn.classList.remove('active');
        }
      }
    }
  }, [isSelectionFormatted]);

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

  // Add keyboard shortcuts and selection listeners
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when not in input fields (except our editor)
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Additional check: don't handle shortcuts if focus is not in our editor
      const editor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
      if (!editor || !editor.contains(target)) {
        return;
      }

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

      // Ctrl+B or Cmd+B for bold
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        try {
          insertFormatting('**', '**');
        } catch (error) {
          console.error('Error applying bold formatting:', error);
        }
      }

      // Ctrl+I or Cmd+I for italic
      if ((event.ctrlKey || event.metaKey) && event.key === 'i') {
        event.preventDefault();
        try {
          insertFormatting('*', '*');
        } catch (error) {
          console.error('Error applying italic formatting:', error);
        }
      }
    };

    const handleSelectionChange = () => {
      // Only update toolbar states if the selection is within our editor
      const editor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
      const selection = window.getSelection();
      if (editor && selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          checkToolbarStates();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [hasChanges, editedContent, originalContent, saveSummary, checkToolbarStates, insertFormatting]);


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
              background: #f8f9fa;
              border-bottom: 1px solid #e9ecef;
              padding: 8px 16px;
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
              transition: none;
            }
            .toolbar-btn:hover {
              background-color: #f1f3f5;
              border-color: #adb5bd;
              color: #212529;
            }
            .toolbar-btn:focus {
              outline: 2px solid #007bff;
              outline-offset: 2px;
            }
            .toolbar-btn.active {
              background-color: #007bff;
              border-color: #007bff;
              color: white;
              box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
            }
            .toolbar-shortcut {
              font-size: 0.65rem;
              opacity: 0.7;
              margin-left: 2px;
            }
          `}
        </style>

        {/* Editor Toolbar */}
        <div className="editor-toolbar">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button className="toolbar-btn" data-format="bold" onClick={() => insertFormatting('**', '**')} title="Bold (Ctrl+B)">
              <i className="bi bi-type-bold"></i>
              <span className="toolbar-shortcut">Ctrl+B</span>
            </button>
            <button className="toolbar-btn" data-format="italic" onClick={() => insertFormatting('*', '*')} title="Italic (Ctrl+I)">
              <i className="bi bi-type-italic"></i>
              <span className="toolbar-shortcut">Ctrl+I</span>
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
            <button className="toolbar-btn" onClick={() => insertReference()} title="Insert Transcript Reference" style={{background: '#6c757d', color: 'white', borderColor: '#6c757d'}}>
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