import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import TurndownService from 'turndown';
import type { Options as TurndownOptions } from 'turndown';
import { marked } from 'marked';
import { apiClient } from '../api';

interface StructuredOverview {
  content?: string;
  references?: number[];
}

interface StructuredDiscussion {
  topic?: string;
  summary?: string;
  references?: number[];
}

interface StructuredDecision {
  decision?: string;
  responsible_party?: string;
  references?: number[];
}

interface StructuredActionItem {
  action?: string;
  owner?: string;
  deadline?: string;
  references?: number[];
}

interface StructuredIssue {
  issue?: string;
  references?: number[];
}

interface StructuredSummary {
  overview?: StructuredOverview;
  key_discussions?: StructuredDiscussion[];
  decisions?: StructuredDecision[];
  action_items?: StructuredActionItem[];
  unresolved_issues?: StructuredIssue[];
  data_and_metrics?: Array<{
    metric?: string;
    value?: string;
    context?: string;
    references?: number[];
  }>;
  concerns_and_risks?: Array<{
    concern?: string;
    references?: number[];
  }>;
}

interface SummaryData {
  formatted_content?: string;
  structured_data?: StructuredSummary;
}

interface TranscriptSegment {
  index: number;
  speaker: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface SummaryWithReferencesProps {
  summary: string | null;
  jobId: number;
  transcriptSegments: TranscriptSegment[];
  onSegmentClick?: (segmentIndex: number | number[]) => void;
  onSummaryUpdate?: (updatedSummary: string) => void;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

const formatReferences = (refs?: number[]): string => {
  if (!refs || refs.length === 0) {
    return '';
  }
  return refs.map(ref => `[${ref}]`).join(' ');
};

const buildMarkdownFromStructuredData = (structured?: StructuredSummary): string => {
  if (!structured) {
    return '';
  }

  const blocks: string[] = [];

  if (structured.overview?.content) {
    const refs = formatReferences(structured.overview.references);
    blocks.push(`## 会议概览\n\n${structured.overview.content}${refs ? ` ${refs}` : ''}`);
  }

  if (structured.key_discussions?.length) {
    const section: string[] = ['## 主要讨论内容'];
    structured.key_discussions.forEach(item => {
      if (!item.summary && !item.topic) {
        return;
      }
      const heading = item.topic ? `### ${item.topic}` : '### 讨论';
      const refs = formatReferences(item.references);
      section.push(`${heading}\n\n${item.summary ?? ''}${refs ? ` ${refs}` : ''}`);
    });
    blocks.push(section.join('\n\n'));
  }

  if (structured.data_and_metrics?.length) {
    const section: string[] = ['## 数据与指标'];
    structured.data_and_metrics.forEach(item => {
      const pieces: string[] = [];
      if (item.metric) {
        pieces.push(`**${item.metric}：**`);
      }
      if (item.value) {
        pieces.push(item.value);
      }
      if (item.context) {
        pieces.push(`（${item.context}）`);
      }
      const refs = formatReferences(item.references);
      section.push(`${pieces.join(' ')}${refs ? ` ${refs}` : ''}`.trim());
    });
    blocks.push(section.join('\n\n'));
  }

  if (structured.concerns_and_risks?.length) {
    const section: string[] = ['## 风险与关注点'];
    structured.concerns_and_risks.forEach(item => {
      if (!item.concern) {
        return;
      }
      const refs = formatReferences(item.references);
      section.push(`${item.concern}${refs ? ` ${refs}` : ''}`);
    });
    blocks.push(section.join('\n\n'));
  }

  if (structured.decisions?.length) {
    const section: string[] = ['## 决策事项'];
    structured.decisions.forEach(item => {
      if (!item.decision && !item.responsible_party) {
        return;
      }
      const lines: string[] = [];
      if (item.decision) {
        lines.push(`**决策：** ${item.decision}`);
      }
      if (item.responsible_party) {
        lines.push(`**负责人：** ${item.responsible_party}`);
      }
      const refs = formatReferences(item.references);
      section.push(`${lines.join('\n')}${refs ? `\n${refs}` : ''}`);
    });
    blocks.push(section.join('\n\n'));
  }

  if (structured.action_items?.length) {
    const section: string[] = ['## 行动项目'];
    structured.action_items.forEach(item => {
      if (!item.action) {
        return;
      }
      const lines: string[] = [`**行动项：** ${item.action}`];
      if (item.owner) {
        lines.push(`**负责人：** ${item.owner}`);
      }
      if (item.deadline) {
        lines.push(`**截止日期：** ${item.deadline}`);
      }
      const refs = formatReferences(item.references);
      section.push(`${lines.join('\n')}${refs ? `\n${refs}` : ''}`);
    });
    blocks.push(section.join('\n\n'));
  }

  if (structured.unresolved_issues?.length) {
    const section: string[] = ['## 未解决问题'];
    structured.unresolved_issues.forEach(item => {
      if (!item.issue) {
        return;
      }
      const refs = formatReferences(item.references);
      section.push(`**问题：** ${item.issue}${refs ? ` ${refs}` : ''}`);
    });
    blocks.push(section.join('\n\n'));
  }

  return blocks.join('\n\n').trim();
};

const InlineBlot = Quill.import('blots/inline') as any;

class ReferenceBlot extends InlineBlot {
  static blotName = 'reference';
  static className = 'summary-ref';
  static tagName = 'span';

  static create(value: string) {
    const node = super.create(value) as HTMLElement;
    const refValue = value ?? '';
    node.setAttribute('data-ref', refValue);
    node.textContent = `[${refValue}]`;
    return node;
  }

  static formats(node: HTMLElement) {
    return node.getAttribute('data-ref') ?? '';
  }
}

Quill.register(ReferenceBlot);

const wrapReferencesWithSpans = (html: string): string => {
  if (!html || typeof window === 'undefined') {
    return html;
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  const pattern = /\[\[?(\d+(?:-\d+)?)\]\]?/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement) {
      continue;
    }
    if (node.parentElement.closest('.summary-ref')) {
      continue;
    }
    if (!pattern.test(node.data)) {
      continue;
    }
    targets.push(node);
  }

  targets.forEach(node => {
    const fragment = document.createDocumentFragment();
    const text = node.data;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const ref = match[1];
      const start = match.index;
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const span = document.createElement('span');
      span.className = 'summary-ref';
      span.setAttribute('data-ref', ref);
      span.textContent = `[${ref}]`;
      fragment.appendChild(span);
      lastIndex = start + fullMatch.length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode?.replaceChild(fragment, node);
  });

  return container.innerHTML;
};

export const SummaryWithReferences: React.FC<SummaryWithReferencesProps> = ({
  summary,
  jobId,
  transcriptSegments: _transcriptSegments,
  onSegmentClick,
  onSummaryUpdate
}) => {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const internalUpdateRef = useRef(false);
  const saveStatusTimer = useRef<number | null>(null);
  const onSegmentClickRef = useRef(onSegmentClick);
  const [baseSummaryData, setBaseSummaryData] = useState<SummaryData | null>(null);
  const [initialMarkdown, setInitialMarkdown] = useState('');
  const [currentMarkdown, setCurrentMarkdown] = useState('');
  const [pendingHtml, setPendingHtml] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [toolbarState, setToolbarState] = useState<{
    bold: boolean;
    italic: boolean;
    header: 0 | 2 | 3;
    list: '' | 'ordered' | 'bullet';
  }>({ bold: false, italic: false, header: 0, list: '' });

  const turndown = useMemo(() => {
    const options: TurndownOptions = {
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-'
    };
    const service = new TurndownService(options);

    service.addRule('referenceSpan', {
      filter: (node: Node) =>
        node instanceof HTMLElement && node.classList.contains('summary-ref'),
      replacement: (_content: string, node: Node) => {
        if (!(node instanceof HTMLElement)) {
          return '';
        }
        const refAttr = node.getAttribute('data-ref');
        if (refAttr) {
          return `[${refAttr}]`;
        }
        const text = (node.textContent ?? '').replace(/\[|\]/g, '').trim();
        return text ? `[${text}]` : '';
      }
    });

    return service;
  }, []);

  const normalizeMarkdown = useCallback((value: string) => {
    if (!value) {
      return '';
    }
    return value
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .trimEnd();
  }, []);

  const areMarkdownEqual = useCallback(
    (a: string, b: string) => normalizeMarkdown(a) === normalizeMarkdown(b),
    [normalizeMarkdown]
  );

  const enhanceHtml = useCallback((html: string) => wrapReferencesWithSpans(html), []);

  const parseSummary = useCallback((rawSummary: string | null) => {
    if (!rawSummary) {
      return {
        base: null,
        markdown: '',
        html: '<p><br></p>'
      };
    }

    try {
      const parsed: SummaryData = JSON.parse(rawSummary);
      let markdown = parsed.formatted_content?.trim() ?? '';

      if (!markdown && parsed.structured_data) {
        markdown = buildMarkdownFromStructuredData(parsed.structured_data);
      }

      if (!markdown) {
        markdown = rawSummary;
      }

      const html = marked.parse(markdown) as string;

      return {
        base: parsed,
        markdown,
        html: html || '<p><br></p>'
      };
    } catch (error) {
      console.error('Failed to parse summary JSON, using raw text:', error);
      const fallbackHtml = marked.parse(rawSummary) as string;

      return {
        base: {
          formatted_content: rawSummary,
          structured_data: {}
        },
        markdown: rawSummary,
        html: fallbackHtml || '<p><br></p>'
      };
    }
  }, []);

  useEffect(() => {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }, []);

  const resetSaveStatusLater = useCallback(() => {
    if (saveStatusTimer.current) {
      window.clearTimeout(saveStatusTimer.current);
    }
    saveStatusTimer.current = window.setTimeout(() => {
      setSaveStatus('idle');
      saveStatusTimer.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveStatusTimer.current) {
        window.clearTimeout(saveStatusTimer.current);
      }
    };
  }, []);

  const updateToolbarState = useCallback(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }

    const range = quill.getSelection();
    if (!range) {
      setToolbarState({ bold: false, italic: false, header: 0, list: '' });
      return;
    }

    const format = quill.getFormat(range.index, range.length);
    setToolbarState({
      bold: Boolean(format.bold),
      italic: Boolean(format.italic),
      header: (format.header ?? 0) as 0 | 2 | 3,
      list: (format.list ?? '') as '' | 'ordered' | 'bullet'
    });
  }, []);

  const updateMarkdownState = useCallback(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const html = quill.root.innerHTML;
    const markdown = turndown.turndown(html);
    const normalized = normalizeMarkdown(markdown);
    setCurrentMarkdown(normalized);
    setHasChanges(!areMarkdownEqual(normalized, initialMarkdown));
  }, [areMarkdownEqual, initialMarkdown, normalizeMarkdown, turndown]);

  const applyReferenceDecorations = useCallback(() => {
    const quill = quillRef.current;
    if (!quill || internalUpdateRef.current) {
      return;
    }
    const currentHtml = quill.root.innerHTML;
    const enhanced = enhanceHtml(currentHtml);
    if (enhanced === currentHtml) {
      return;
    }

    internalUpdateRef.current = true;
    const selection = quill.getSelection();
    // @ts-ignore quill typings expect object but runtime accepts string
    const delta = quill.clipboard.convert(enhanced);
    quill.setContents(delta, 'silent');
    if (selection) {
      quill.setSelection(selection.index, selection.length, 'silent');
    }
    internalUpdateRef.current = false;
  }, [enhanceHtml]);

  const loadHtmlIntoEditor = useCallback((html: string) => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const safeHtml = html && html.trim() ? html : '<p><br></p>';
    internalUpdateRef.current = true;
    // @ts-ignore quill typings expect object but runtime accepts string
    const delta = quill.clipboard.convert(safeHtml);
    quill.setContents(delta, 'silent');
    quill.history.clear();
    quill.setSelection(quill.getLength(), 0, 'silent');
    internalUpdateRef.current = false;
    applyReferenceDecorations();
    updateToolbarState();
    updateMarkdownState();
  }, [applyReferenceDecorations, updateMarkdownState, updateToolbarState]);

  const initializeQuill = useCallback(() => {
    const host = editorHostRef.current;
    if (!host || quillRef.current) {
      return;
    }

    const previousToolbar = host.previousElementSibling;
    if (previousToolbar && previousToolbar.classList.contains('ql-toolbar')) {
      previousToolbar.remove();
    }
    host.innerHTML = '';

    const quill = new Quill(host, {
      theme: 'snow',
      modules: {
        toolbar: false,
        history: {
          delay: 500,
          maxStack: 200,
          userOnly: true
        }
      }
    });

    quill.root.style.whiteSpace = 'pre-wrap';

    quill.clipboard.addMatcher('span.summary-ref', (node: Node, delta: any) => {
      const refValue = (node as HTMLElement).getAttribute('data-ref') ?? '';
      delta.ops = [{ insert: `[${refValue}]`, attributes: { reference: refValue } }];
      return delta;
    });

    const handleTextChange = () => {
      if (internalUpdateRef.current) {
        return;
      }
      applyReferenceDecorations();
      updateMarkdownState();
      updateToolbarState();
    };

    const handleSelectionChange = () => {
      updateToolbarState();
    };

    quill.on('text-change', handleTextChange);
    quill.on('selection-change', handleSelectionChange);

    const root = quill.root;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const refSpan = target.closest('.summary-ref') as HTMLElement | null;
      if (!refSpan) {
        return;
      }
      const refAttr = refSpan.getAttribute('data-ref');
      if (!refAttr) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const segmentClick = onSegmentClickRef.current;
      if (!segmentClick) {
        return;
      }

      if (refAttr.includes('-')) {
        const [start, end] = refAttr.split('-').map(Number).filter(n => !Number.isNaN(n));
        if (start && end && end >= start) {
          const range: number[] = [];
          for (let i = start; i <= end; i += 1) {
            range.push(i);
          }
          segmentClick(range);
        }
        return;
      }

      const single = parseInt(refAttr, 10);
      if (!Number.isNaN(single)) {
        segmentClick(single);
      }
    };

    root.addEventListener('click', handleClick);

    quillRef.current = quill;
    loadHtmlIntoEditor(pendingHtml);

    return () => {
      quill.off('text-change', handleTextChange);
      quill.off('selection-change', handleSelectionChange);
      root.removeEventListener('click', handleClick);
      quillRef.current = null;
      const toolbarEl = host.previousElementSibling;
      if (toolbarEl && toolbarEl.classList.contains('ql-toolbar')) {
        toolbarEl.remove();
      }
      host.innerHTML = '';
    };
  }, [applyReferenceDecorations, loadHtmlIntoEditor, pendingHtml, updateMarkdownState, updateToolbarState]);

  useEffect(() => {
    const cleanup = initializeQuill();
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [initializeQuill]);

  useEffect(() => {
    const parsed = parseSummary(summary);
    const enhancedHtml = enhanceHtml(parsed.html);
    const normalizedMarkdown = normalizeMarkdown(parsed.markdown);
    setBaseSummaryData(parsed.base);
    setInitialMarkdown(normalizedMarkdown);
    setCurrentMarkdown(normalizedMarkdown);
    setPendingHtml(enhancedHtml);
    setHasChanges(false);
    setSaveStatus('idle');

    if (saveStatusTimer.current) {
      window.clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = null;
    }
  }, [summary, parseSummary, enhanceHtml, normalizeMarkdown]);

  useEffect(() => {
    loadHtmlIntoEditor(pendingHtml);
  }, [loadHtmlIntoEditor, pendingHtml]);

  useEffect(() => {
    onSegmentClickRef.current = onSegmentClick;
  }, [onSegmentClick]);

  const withEditor = useCallback((action: (quill: Quill) => void) => {
    const quill = quillRef.current;
    if (quill) {
      action(quill);
    }
  }, []);

  const handleUndo = useCallback(() => {
    withEditor(quill => {
      quill.history.undo();
    });
  }, [withEditor]);

  const handleRedo = useCallback(() => {
    withEditor(quill => {
      quill.history.redo();
    });
  }, [withEditor]);

  const toggleFormat = useCallback((format: 'bold' | 'italic') => {
    withEditor(quill => {
      const range = quill.getSelection(true);
      if (!range) {
        return;
      }
      const current = quill.getFormat(range.index, range.length);
      quill.format(format, !current[format]);
    });
  }, [withEditor]);

  const applyHeading = useCallback((level: 2 | 3) => {
    withEditor(quill => {
      const range = quill.getSelection(true);
      if (!range) {
        return;
      }
      const current = quill.getFormat(range.index, range.length);
      if (current.header === level) {
        quill.format('header', false);
      } else {
        quill.format('header', level);
      }
    });
  }, [withEditor]);

  const toggleList = useCallback((type: 'ordered' | 'bullet') => {
    withEditor(quill => {
      const range = quill.getSelection(true);
      if (!range) {
        return;
      }
      const current = quill.getFormat(range.index, range.length);
      if (current.list === type) {
        quill.format('list', false);
      } else {
        quill.format('list', type);
      }
    });
  }, [withEditor]);

  const handleInsertReference = useCallback(() => {
    const userInput = window.prompt('Enter transcript segment number (e.g. 3 or 5-7):');
    if (!userInput) {
      return;
    }
    const cleaned = userInput.replace(/[^0-9-]/g, '');
    if (!cleaned) {
      return;
    }
    const display = `[${cleaned}]`;

    withEditor(quill => {
      const range = quill.getSelection(true);
      const insertIndex = range ? range.index : quill.getLength();
      if (range && range.length > 0) {
        quill.deleteText(range.index, range.length, 'silent');
      }
      quill.insertText(insertIndex, display, 'user');
      quill.formatText(insertIndex, display.length, 'reference', cleaned, 'user');
      quill.setSelection(insertIndex + display.length, 0, 'silent');
      updateMarkdownState();
    });
  }, [updateMarkdownState, withEditor]);

  const handleSave = useCallback(async () => {
    if (!hasChanges || saveStatus === 'saving') {
      return;
    }

    setSaveStatus('saving');

    try {
      const base = baseSummaryData ?? { structured_data: {} };
      const formattedContent = normalizeMarkdown(currentMarkdown);
      const updated: SummaryData = {
        ...base,
        formatted_content: formattedContent
      };

      await apiClient.post(
        `/jobs/${jobId}/update_summary`,
        { summary: JSON.stringify(updated) },
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (onSummaryUpdate) {
        onSummaryUpdate(JSON.stringify(updated));
      }

      setBaseSummaryData(updated);
      setInitialMarkdown(formattedContent);
      setCurrentMarkdown(formattedContent);
      setHasChanges(false);
      setSaveStatus('success');
      resetSaveStatusLater();
    } catch (error) {
      console.error('Error saving summary:', error);
      setSaveStatus('error');
      resetSaveStatusLater();
    }
  }, [
    baseSummaryData,
    currentMarkdown,
    hasChanges,
    jobId,
    normalizeMarkdown,
    onSummaryUpdate,
    resetSaveStatusLater,
    saveStatus
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const statusLabel = useMemo(() => {
    if (saveStatus === 'saving') {
      return (
        <>
          <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
          Saving...
        </>
      );
    }
    if (saveStatus === 'success') {
      return (
        <>
          <i className="bi bi-check-circle me-1" />
          Saved
        </>
      );
    }
    if (saveStatus === 'error') {
      return (
        <>
          <i className="bi bi-exclamation-triangle me-1" />
          Save failed
        </>
      );
    }
    return (
      <>
        <i className="bi bi-save me-1" />
        Save
      </>
    );
  }, [saveStatus]);

  const saveButtonClass = useMemo(() => {
    if (saveStatus === 'success') {
      return 'btn-success';
    }
    if (saveStatus === 'error') {
      return 'btn-danger';
    }
    return hasChanges ? 'btn-outline-success' : 'btn-outline-secondary';
  }, [hasChanges, saveStatus]);

  const isSaveDisabled = saveStatus === 'saving' || (!hasChanges && saveStatus !== 'error');

  if (!summary) {
    return (
      <div className="alert alert-info">
        No meeting summary yet. Click “Generate Summary” to create one.
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom bg-light">
        <div>
          <h6 className="mb-0 text-muted">
            <i className="bi bi-journal-text me-2" />
            Meeting Summary
          </h6>
          {hasChanges && (
            <small className="text-warning">
              <i className="bi bi-exclamation-circle me-1" />
              Unsaved changes
            </small>
          )}
        </div>
        <button
          type="button"
          className={`btn btn-sm ${saveButtonClass}`}
          onClick={handleSave}
          disabled={isSaveDisabled}
          title="Ctrl + S"
          style={{ height: '32px', fontSize: '0.75rem', padding: '4px 8px' }}
        >
          {statusLabel}
        </button>
      </div>

      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-white flex-wrap">
        <div className="btn-group btn-group-sm" role="group" aria-label="Undo/Redo">
          <button type="button" className="btn btn-outline-secondary" onClick={handleUndo}>
            <i className="bi bi-arrow-counterclockwise" />
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={handleRedo}>
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>
        <div className="btn-group btn-group-sm" role="group" aria-label="Text styles">
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.bold ? 'active' : ''}`}
            onClick={() => toggleFormat('bold')}
          >
            <i className="bi bi-type-bold" />
          </button>
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.italic ? 'active' : ''}`}
            onClick={() => toggleFormat('italic')}
          >
            <i className="bi bi-type-italic" />
          </button>
        </div>
        <div className="btn-group btn-group-sm" role="group" aria-label="Headings">
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.header === 2 ? 'active' : ''}`}
            onClick={() => applyHeading(2)}
          >
            H2
          </button>
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.header === 3 ? 'active' : ''}`}
            onClick={() => applyHeading(3)}
          >
            H3
          </button>
        </div>
        <div className="btn-group btn-group-sm" role="group" aria-label="Lists">
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.list === 'bullet' ? 'active' : ''}`}
            onClick={() => toggleList('bullet')}
          >
            <i className="bi bi-list-ul" />
          </button>
          <button
            type="button"
            className={`btn btn-outline-secondary ${toolbarState.list === 'ordered' ? 'active' : ''}`}
            onClick={() => toggleList('ordered')}
          >
            <i className="bi bi-list-ol" />
          </button>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleInsertReference}>
          <i className="bi bi-link-45deg me-1" />
          Insert Reference
        </button>
      </div>

      <div className="flex-grow-1 overflow-auto">
        <style>
          {`
            .ql-container.ql-snow {
              border: none;
            }
            .ql-editor {
              min-height: 400px;
              padding: 24px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              font-size: 11pt;
              line-height: 1.6;
              color: #212529;
              white-space: pre-wrap;
            }
            .ql-editor p {
              margin: 0 0 12pt 0;
              white-space: pre-wrap;
            }
            .ql-editor h2,
            .ql-editor h3 {
              margin-top: 24pt;
              margin-bottom: 12pt;
              font-weight: 600;
            }
            .ql-editor h2 {
              border-bottom: 1px solid #e9ecef;
              padding-bottom: 6pt;
            }
            .summary-ref {
              color: #0d6efd;
              background-color: #e7f1ff;
              padding: 2px 6px;
              border-radius: 4px;
              cursor: pointer;
              margin: 0 2px;
              display: inline-block;
            }
            .summary-ref:hover {
              background-color: #cfe2ff;
            }
          `}
        </style>
        <div ref={editorHostRef} />
      </div>
    </div>
  );
};
