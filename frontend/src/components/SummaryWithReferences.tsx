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
  const [isUnmounted, setIsUnmounted] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Undo/Redo state management
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const maxHistorySize = 50; // Limit history size to prevent memory issues

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
          // Initialize history with the first content
          setHistory([processedContent]);
          setHistoryIndex(0);
        } else {
          // Fallback: if no formatted content, create a simple message
          const fallbackContent = 'No formatted summary available. Please generate a new summary.';
          setEditedContent(fallbackContent);
          setOriginalContent(fallbackContent);
          // Initialize history with the fallback content
          setHistory([fallbackContent]);
          setHistoryIndex(0);
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
        // Initialize history with the summary content
        setHistory([summary]);
        setHistoryIndex(0);
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
    if (!editedContent.trim()) {
      return '<p><br></p>';
    }

    let html = editedContent;

    // Split into lines to handle line breaks properly
    const lines = html.split('\n');
    let processedLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Handle headers
      if (line.startsWith('###### ')) {
        processedLines.push(`<h6>${line.substring(7)}</h6>`);
      } else if (line.startsWith('##### ')) {
        processedLines.push(`<h5>${line.substring(6)}</h5>`);
      } else if (line.startsWith('#### ')) {
        processedLines.push(`<h4>${line.substring(5)}</h4>`);
      } else if (line.startsWith('### ')) {
        processedLines.push(`<h3>${line.substring(4)}</h3>`);
      } else if (line.startsWith('## ')) {
        processedLines.push(`<h2>${line.substring(3)}</h2>`);
      } else if (line.startsWith('# ')) {
        processedLines.push(`<h1>${line.substring(2)}</h1>`);
      }
      // Handle list items
      else if (line.match(/^(\d+)\. .+$/)) {
        let listItems = [];
        // Collect consecutive numbered list items
        while (i < lines.length && lines[i].match(/^(\d+)\. .+$/)) {
          listItems.push(`<li>${lines[i].replace(/^(\d+)\. /, '$1. ')}</li>`);
          i++;
        }
        processedLines.push(`<ol>${listItems.join('')}</ol>`);
        continue; // Skip the i++ since we already incremented it
      }
      else if (line.startsWith('- ')) {
        let listItems = [];
        // Collect consecutive bullet list items
        while (i < lines.length && lines[i].startsWith('- ')) {
          listItems.push(`<li>${lines[i].substring(2)}</li>`);
          i++;
        }
        processedLines.push(`<ul>${listItems.join('')}</ul>`);
        continue; // Skip the i++ since we already incremented it
      }
      // Handle empty lines
      else if (line.trim() === '') {
        // Add paragraph break
        if (processedLines.length > 0 && !processedLines[processedLines.length - 1].match(/^<h[1-6]>/) &&
            !processedLines[processedLines.length - 1].endsWith('</ul>') &&
            !processedLines[processedLines.length - 1].endsWith('</ol>')) {
          processedLines.push('</p><p>');
        }
      }
      // Handle regular text
      else {
        // Apply formatting to regular text
        let formattedLine = line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/\[\[(\d+(?:-\d+)?)\]\]/g, '<span class="transcript-ref" data-ref="$1">$1</span>');

        processedLines.push(formattedLine);
      }

      i++;
    }

    // Join the processed lines and wrap in paragraphs
    let finalHtml = processedLines.join('<br>');

    // If the content doesn't start with a header or list, wrap it in paragraphs
    if (!finalHtml.startsWith('<h') && !finalHtml.startsWith('<ul>') && !finalHtml.startsWith('<ol>')) {
      finalHtml = '<p>' + finalHtml + '</p>';
    }

    // Clean up double paragraphs and ensure proper structure
    finalHtml = finalHtml
      .replace(/<\/p><p><br>/g, '</p><p>')
      .replace(/<p>(<h[1-6]>)/g, '$1')
      .replace(/(<\/h[1-6]>)<\/p>/g, '$1')
      .replace(/<p>(<ul>|<ol>)/g, '$1')
      .replace(/(<\/ul>|<\/ol>)<\/p>/g, '$1')
      .replace(/<p><\/p>/g, '<p><br></p>');

    return finalHtml;
  }, [editedContent]);

  // Convert HTML back to markdown
  const htmlToMarkdown = useCallback((html: string): string => {
    if (!html) return '';

    let markdown = html
      // Handle headers first (before paragraph processing)
      .replace(/<h1>(.+?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2>(.+?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3>(.+?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4>(.+?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5>(.+?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6>(.+?)<\/h6>/gi, '###### $1\n\n')
      // Handle bold and italic
      .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
      .replace(/<em>(.+?)<\/em>/gi, '*$1*')
      // Handle transcript references
      .replace(/<span class="transcript-ref"[^>]*data-ref="([^"]*)"[^>]*>([^<]+)<\/span>/gi, '[[$1]]')
      // Handle lists (preserve structure)
      .replace(/<ol>(.*?)<\/ol>/gis, (match, content) => {
        return content.replace(/<li>(.+?)<\/li>/gi, '$1\n').replace(/^\d+\.\s/, '');
      })
      .replace(/<ul>(.*?)<\/ul>/gis, (match, content) => {
        return content.replace(/<li>(.+?)<\/li>/gi, '- $1\n');
      })
      // Handle paragraphs - convert to line breaks
      .replace(/<\/p>/g, '\n\n')
      .replace(/<p>/g, '')
      // Handle line breaks - convert to single line breaks
      .replace(/<br\s*\/?>/gi, '\n')
      // Handle div separators
      .replace(/<\/div>/gi, '\n')
      .replace(/<div[^>]*>/gi, '')
      // Clean up HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      // Clean up extra whitespace but preserve paragraph structure
      .replace(/\n{4,}/g, '\n\n\n') // Limit to max 3 consecutive line breaks
      .replace(/[ \t]+$/gm, '') // Remove trailing spaces
      .replace(/^\s+|\s+$/g, '') // Trim leading/trailing whitespace
      .replace(/\n[ \t]+\n/g, '\n\n') // Clean lines with only whitespace
      .replace(/\n{3,}/g, '\n\n'); // Finally, ensure max 2 consecutive line breaks

    return markdown;
  }, []);

  // Add content to history
  const addToHistory = useCallback((content: string) => {
    setHistory(prevHistory => {
      setHistoryIndex(prevIndex => {
        // If we're not at the end of history, truncate the future history
        let newHistory = prevIndex < prevHistory.length - 1
          ? prevHistory.slice(0, prevIndex + 1)
          : [...prevHistory];

        // Add the new content
        newHistory.push(content);

        // Limit history size
        if (newHistory.length > maxHistorySize) {
          newHistory = newHistory.slice(-maxHistorySize);
          return newHistory.length - 1;
        }

        return newHistory.length - 1;
      });
      return prevHistory;
    });
  }, []);

  // Undo function
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const content = history[newIndex];
      setEditedContent(content);
      setHasChanges(content !== originalContent);

      // Update editor content
      const editor = editorRef.current;
      if (editor) {
        const htmlContent = getHtmlContent();
        editor.innerHTML = htmlContent;
      }
    }
  }, [historyIndex, history, originalContent, getHtmlContent]);

  // Redo function
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const content = history[newIndex];
      setEditedContent(content);
      setHasChanges(content !== originalContent);

      // Update editor content
      const editor = editorRef.current;
      if (editor) {
        const htmlContent = getHtmlContent();
        editor.innerHTML = htmlContent;
      }
    }
  }, [historyIndex, history, originalContent, getHtmlContent]);

  // Handle WYSIWYG input with auto-save
  const handleWysiwygInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    e.persist();
    const target = e.currentTarget;
    const htmlContent = target.innerHTML;

    // Normalize HTML to handle different ways browsers create line breaks
    const normalizedHtml = htmlContent
      // Ensure consistent paragraph structure
      .replace(/<div><br><\/div>/g, '<p><br></p>')
      .replace(/<div([^>]*)>(.*?)<\/div>/g, '<p>$2</p>')
      // Handle multiple consecutive line breaks
      .replace(/(<br\s*\/?>){3,}/g, '<br><br>')
      // Clean up empty paragraphs
      .replace(/<p><\/p>/g, '<p><br></p>')
      // Ensure proper spacing around elements
      .replace(/><(p|div|h[1-6]|ul|ol)>/g, '><$1>');

    const markdownContent = htmlToMarkdown(normalizedHtml);

    // Only add to history if content actually changed
    if (markdownContent !== editedContent) {
      // Use requestAnimationFrame to avoid blocking the input thread
      requestAnimationFrame(() => {
        setEditedContent(markdownContent);
        setHasChanges(markdownContent !== originalContent);
        addToHistory(markdownContent);
      });
    }
  }, [htmlToMarkdown, originalContent, editedContent, addToHistory]);

  // Handle focus to track editing state
  const handleEditorFocus = useCallback(() => {
    setIsEditing(true);
  }, []);

  // Handle blur to save content
  const handleEditorBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Small delay to allow related target to be properly set
    setTimeout(() => {
      // Check if focus moved outside the editor
      const editor = editorRef.current;
      if (editor && !editor.contains(document.activeElement)) {
        const target = e.currentTarget;
        const htmlContent = target.innerHTML;
        const markdownContent = htmlToMarkdown(htmlContent);

        setEditedContent(markdownContent);
        setHasChanges(markdownContent !== originalContent);
        setIsEditing(false);
      }
    }, 10);
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

  // Restore focus to editor and get selection
  const restoreEditorFocus = useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.focus();

      // Wait a tick for focus to be restored, then get selection
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount === 0) {
          // Create a new range at the end of editor content
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }, 0);
    }
  }, []);

  // Insert formatting at cursor position
  const insertFormatting = useCallback((before: string, after: string) => {
    // First, ensure editor has focus
    restoreEditorFocus();

    // Wait for focus to be restored before proceeding
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        console.warn('No selection available when trying to format');
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

        // Trigger input event to update the editor content with a delay to preserve focus
        const wysiwygEditor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
        if (wysiwygEditor) {
          // Use requestAnimationFrame to ensure focus is preserved
          requestAnimationFrame(() => {
            const inputEvent = new Event('input', { bubbles: true });
            wysiwygEditor.dispatchEvent(inputEvent);
          });
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
      // Also update the content state and add to history after formatting
      setTimeout(() => {
        const editor = document.querySelector('.wysiwyg-editor') as HTMLDivElement;
        if (editor) {
          const newHtmlContent = editor.innerHTML;
          const newMarkdownContent = htmlToMarkdown(newHtmlContent);
          if (newMarkdownContent !== editedContent) {
            setEditedContent(newMarkdownContent);
            setHasChanges(newMarkdownContent !== originalContent);
            addToHistory(newMarkdownContent);
          }
        }
      }, 50);
    }, 10); // Small delay to ensure focus is restored
  }, [isSelectionFormatted, restoreEditorFocus, editedContent, originalContent, htmlToMarkdown, addToHistory]);

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
        const editor = editorRef.current;
        if (editor) {
          editor.innerHTML = getHtmlContent();
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
    const editor = editorRef.current;
    if (editor && editedContent && !isInitialized) {
      const htmlContent = getHtmlContent();

      // Only set content if the editor doesn't have focus
      if (!editor.contains(document.activeElement)) {
        editor.innerHTML = htmlContent;
      }

      setIsInitialized(true);
    }
  }, [editedContent, getHtmlContent, isInitialized]);

  // Also ensure content is rendered when component mounts or ref is set
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editedContent && !isInitialized) {
      const htmlContent = getHtmlContent();

      // Only set content if the editor doesn't have focus
      if (!editor.contains(document.activeElement)) {
        editor.innerHTML = htmlContent;
      }

      setIsInitialized(true);
    }
  }, [editorRef, editedContent, getHtmlContent, isInitialized]);

  // Prevent content from being overwritten by React's reconciliation
  useEffect(() => {
    if (isUnmounted) return;

    const editor = editorRef.current;
    if (editor && isInitialized && editedContent && !isEditing && !document.activeElement?.isEqualNode(editor)) {
      const htmlContent = getHtmlContent();
      if (editor.innerHTML !== htmlContent) {
        // Save the current selection if there is one
        const selection = window.getSelection();
        const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

        // Double-check editor still exists before updating
        if (editorRef.current && !isUnmounted) {
          editorRef.current.innerHTML = htmlContent;

          // Restore the selection if we saved it and the editor doesn't have focus
          if (savedRange && !editor.contains(document.activeElement)) {
            try {
              const newRange = document.createRange();
              newRange.setStart(editor, 0);
              newRange.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(newRange);
            } catch (error) {
              // If we can't restore the range, that's okay - just ensure the editor doesn't lose focus
            }
          }
        }
      }
    }
  }, [editedContent, getHtmlContent, isInitialized, isEditing, isUnmounted]);

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

      // Handle Enter key for proper line breaks
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        // Let the browser handle Enter naturally for contentEditable
        // We'll process the resulting HTML in handleWysiwygInput
        // Don't prevent default - let it create the line break
        setTimeout(() => {
          // Force content update after Enter key with a delay to preserve focus
          if (editor && editor.contains(document.activeElement)) {
            requestAnimationFrame(() => {
              const inputEvent = new Event('input', { bubbles: true });
              editor.dispatchEvent(inputEvent);
            });
          }
        }, 0);
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

      // Ctrl+Z or Cmd+Z for undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        try {
          undo();
        } catch (error) {
          console.error('Error undoing:', error);
        }
      }

      // Ctrl+Y or Cmd+Shift+Z for redo
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        try {
          redo();
        } catch (error) {
          console.error('Error redoing:', error);
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
      setIsUnmounted(true);
    };
  }, [hasChanges, editedContent, originalContent, saveSummary, checkToolbarStates, insertFormatting, undo, redo]);

  // Cleanup effect to prevent memory leaks
  useEffect(() => {
    return () => {
      setIsUnmounted(true);
    };
  }, []);


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
              white-space: pre-wrap;
              word-wrap: break-word;
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
              min-height: 1.6em;
            }
            p:empty {
              min-height: 1.6em;
              margin-bottom: 1rem;
            }
            p:empty:before {
              content: "";
              display: inline-block;
            }
            br {
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
            .toolbar-btn:disabled,
            .toolbar-btn.disabled {
              cursor: not-allowed;
              pointer-events: none;
            }
            .toolbar-btn:disabled:hover,
            .toolbar-btn.disabled:hover {
              background-color: white;
              border-color: #dee2e6;
              color: #495057;
            }
          `}
        </style>

        {/* Editor Toolbar */}
        <div className="editor-toolbar">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <button
              className={`toolbar-btn ${historyIndex <= 0 ? 'disabled' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                if (historyIndex > 0) {
                  undo();
                }
              }}
              title="Undo (Ctrl+Z)"
              disabled={historyIndex <= 0}
              style={{ opacity: historyIndex <= 0 ? 0.5 : 1 }}
            >
              <i className="bi bi-arrow-counterclockwise"></i>
              <span className="toolbar-shortcut">Ctrl+Z</span>
            </button>
            <button
              className={`toolbar-btn ${historyIndex >= history.length - 1 ? 'disabled' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                if (historyIndex < history.length - 1) {
                  redo();
                }
              }}
              title="Redo (Ctrl+Y)"
              disabled={historyIndex >= history.length - 1}
              style={{ opacity: historyIndex >= history.length - 1 ? 0.5 : 1 }}
            >
              <i className="bi bi-arrow-clockwise"></i>
              <span className="toolbar-shortcut">Ctrl+Y</span>
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button
              className="toolbar-btn"
              data-format="bold"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('**', '**');
              }}
              title="Bold (Ctrl+B)"
            >
              <i className="bi bi-type-bold"></i>
              <span className="toolbar-shortcut">Ctrl+B</span>
            </button>
            <button
              className="toolbar-btn"
              data-format="italic"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('*', '*');
              }}
              title="Italic (Ctrl+I)"
            >
              <i className="bi bi-type-italic"></i>
              <span className="toolbar-shortcut">Ctrl+I</span>
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button
              className="toolbar-btn"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('## ', '');
              }}
              title="Heading 2"
            >
              H2
            </button>
            <button
              className="toolbar-btn"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('### ', '');
              }}
              title="Heading 3"
            >
              H3
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button
              className="toolbar-btn"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('- ', '');
              }}
              title="Bullet List"
            >
              <i className="bi bi-list-ul"></i>
            </button>
            <button
              className="toolbar-btn"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertFormatting('1. ', '');
              }}
              title="Numbered List"
            >
              <i className="bi bi-list-ol"></i>
            </button>
            <div className="border-start" style={{height: '16px', margin: '0 6px', borderLeftWidth: '1px'}}></div>
            <button
              className="toolbar-btn"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent losing focus
                insertReference();
              }}
              title="Insert Transcript Reference"
              style={{background: '#6c757d', color: 'white', borderColor: '#6c757d'}}
            >
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