import React, { useState, useEffect, useRef, useCallback } from 'react';

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
  const [editedContent, setEditedContent] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
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
        } else {
          // Fallback: if no formatted content, create a simple message
          const fallbackContent = 'No formatted summary available. Please generate a new summary.';
          setEditedContent(fallbackContent);
        }
      } catch (error) {
        console.error('Error parsing summary:', error);
        // Fallback for old format summaries - convert to markdown
        setSummaryData({
          formatted_content: summary,
          structured_data: {}
        });
        setEditedContent(summary);
      }
    }
  }, [summary]);

  // Initialize editor content when summary changes or when editor is ready
  useEffect(() => {
    if (editorRef.current && editedContent && !isInitialized) {
      editorRef.current.innerHTML = getHtmlContent();
      setIsInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedContent, isInitialized]);

  
  
  
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

  // Handle WYSIWYG input with auto-save
  const handleWysiwygInput = (e: React.FormEvent<HTMLDivElement>) => {
    // Don't update state during input to avoid cursor jumping
    // The content will be synced when the user leaves the editor
    e.persist();
  };

  // Handle blur to save content
  const handleEditorBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const content = e.currentTarget.innerText || '';
    setEditedContent(content);
    // Don't re-render the editor content on blur to preserve user edits
  };

  // Insert formatting at cursor position
  const insertFormatting = (before: string, after: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const selectedText = range.toString() || 'text';

      // For WYSIWYG contentEditable div
      document.execCommand('insertText', false, before + selectedText + after);

      // Auto-save after formatting
      const wysiwygEditor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
      if (wysiwygEditor) {
        const content = wysiwygEditor.innerText || '';
        setEditedContent(content);
      }
    }
  };

  // Insert transcript reference
  const insertReference = () => {
    const segmentNumber = prompt('Enter transcript segment number (or range like 2-3):');
    if (segmentNumber) {
      insertFormatting(`[[${segmentNumber}]]`, '');
    }
  };

  
  
  if (!summary) {
    return (
      <div className="alert alert-info">
        No summary generated yet. Click the Generate Summary button to create one.
      </div>
    );
  }

  return (
    <div className="summary-with-references" style={{height: '100%', display: 'flex', flexDirection: 'column', padding: '0'}}>

      
      <div className="flex-grow-1 d-flex flex-column" style={{minHeight: '0'}}>
          <div className="mb-3 flex-grow-1 d-flex flex-column" style={{minHeight: '0'}}>
            <div className="border rounded" style={{flexGrow: 1, display: 'flex', flexDirection: 'column'}}>
              
              {/* Editor Content */}
              <div className="p-3 overflow-auto" style={{flexGrow: 1, minHeight: '400px'}}>
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
                    }
                    .wysiwyg-editor:focus {
                      outline: 2px solid #007bff;
                      outline-offset: 2px;
                      border-radius: 4px;
                    }
                    .transcript-ref {
                      color: #007bff;
                      text-decoration: none;
                      background-color: #e7f3ff;
                      padding: 1px 4px;
                      border-radius: 3px;
                      font-weight: 500;
                      cursor: pointer;
                      display: inline-block;
                      transition: all 0.2s ease;
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
                      padding: 0.5rem 1rem;
                    }
                    .toolbar-btn {
                      border: none;
                      background: none;
                      padding: 0.25rem 0.5rem;
                      margin: 0 0.125rem;
                      border-radius: 0.25rem;
                      cursor: pointer;
                      color: #495057;
                      font-size: 0.875rem;
                    }
                    .toolbar-btn:hover {
                      background-color: #e9ecef;
                      color: #212529;
                    }
                    .toolbar-btn.active {
                      background-color: #007bff;
                      color: white;
                    }
                  `}
                </style>
                <div className="editor-toolbar">
                  <div className="d-flex align-items-center gap-2">
                    <button className="toolbar-btn" onClick={() => insertFormatting('**', '**')} title="Bold">
                      <i className="bi bi-type-bold"></i>
                    </button>
                    <button className="toolbar-btn" onClick={() => insertFormatting('*', '*')} title="Italic">
                      <i className="bi bi-type-italic"></i>
                    </button>
                    <div className="border-start" style={{height: '20px', margin: '0 0.5rem'}}></div>
                    <button className="toolbar-btn" onClick={() => insertFormatting('## ', '')} title="Heading 2">
                      H2
                    </button>
                    <button className="toolbar-btn" onClick={() => insertFormatting('### ', '')} title="Heading 3">
                      H3
                    </button>
                    <div className="border-start" style={{height: '20px', margin: '0 0.5rem'}}></div>
                    <button className="toolbar-btn" onClick={() => insertFormatting('- ', '')} title="Bullet List">
                      <i className="bi bi-list-ul"></i>
                    </button>
                    <button className="toolbar-btn" onClick={() => insertFormatting('1. ', '')} title="Numbered List">
                      <i className="bi bi-list-ol"></i>
                    </button>
                    <div className="border-start" style={{height: '20px', margin: '0 0.5rem'}}></div>
                    <button className="toolbar-btn" onClick={() => insertReference()} title="Insert Transcript Reference">
                      <i className="bi bi-link-45deg"></i> Ref
                    </button>
                  </div>
                </div>
                <div
                  ref={editorRef}
                  className="wysiwyg-editor p-3"
                  contentEditable
                  suppressContentEditableWarning={true}
                  onInput={handleWysiwygInput}
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
          </div>
        </div>

    </div>
  );
};