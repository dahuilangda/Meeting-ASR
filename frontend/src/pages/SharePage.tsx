import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { fetchPublicShare, downloadSharedResource, PublicShareDetails } from '../api';

const getFilenameFromContentDisposition = (header?: string | null): string | null => {
  if (!header) {
    return null;
  }

  const filenameStarMatch = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (filenameStarMatch) {
    try {
      return decodeURIComponent(filenameStarMatch[1]);
    } catch {
      return filenameStarMatch[1];
    }
  }

  const filenameMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return filenameMatch ? filenameMatch[1] : null;
};

const buildDefaultFilename = (original: string, fallback: string): string => {
  const base = original ? original.replace(/\.[^/.]+$/, '') : 'shared-job';
  return `${base}${fallback}`;
};

const resolveHttpStatus = (error: unknown): number | undefined => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (response && typeof response.status === 'number') {
      return response.status;
    }
  }
  return undefined;
};

const SharePage: React.FC = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<PublicShareDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresCode, setRequiresCode] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [authorizedCode, setAuthorizedCode] = useState<string | undefined>(undefined);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [downloading, setDownloading] = useState<'audio' | 'transcript' | 'summary' | null>(null);

  const loadShareDetails = useCallback(
    async (accessCode?: string) => {
      if (!shareToken) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const details = await fetchPublicShare(shareToken, accessCode);
        setShare(details);
        setRequiresCode(details.requires_access_code && !accessCode);
        setAuthorizedCode(accessCode);
        setError(null);
        if (accessCode) {
          setCodeInput('');
        }
      } catch (err) {
        setShare(null);
        const status = resolveHttpStatus(err);
        if (status !== undefined) {
          if (status === 401) {
            setRequiresCode(true);
            setError('该分享需要提取码。');
          } else if (status === 403) {
            setRequiresCode(true);
            setError('提取码错误，请重试。');
          } else if (status === 404) {
            setError('分享不存在或已被删除。');
          } else if (status === 410) {
            setError('分享链接已过期。');
          } else {
            setError('无法加载分享内容，请稍后重试。');
          }
        } else {
          setError('无法加载分享内容，请稍后重试。');
        }
      } finally {
        setLoading(false);
      }
    },
    [shareToken]
  );

  useEffect(() => {
    if (shareToken) {
      loadShareDetails();
    }
  }, [loadShareDetails, shareToken]);

  const handleSubmitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!codeInput.trim()) {
      setError('请输入提取码');
      return;
    }
    setVerificationLoading(true);
    await loadShareDetails(codeInput.trim());
    setVerificationLoading(false);
  };

  const handleDownload = useCallback(
    async (resource: 'audio' | 'transcript' | 'summary') => {
      if (!shareToken) {
        return;
      }
      if (share?.requires_access_code && !authorizedCode) {
        setError('下载前需要先输入正确的提取码。');
        return;
      }

      setDownloading(resource);
      setError(null);
      try {
        const response = await downloadSharedResource(shareToken, resource, authorizedCode);
        const headers = response.headers as Record<string, string | undefined>;
        const contentType = headers['content-type'] ?? headers['Content-Type'] ?? 'application/octet-stream';
        const blob = response.data instanceof Blob
          ? response.data
          : new Blob([response.data], { type: contentType });
        const disposition = headers['content-disposition'] ?? headers['Content-Disposition'];
        const filename =
          getFilenameFromContentDisposition(disposition) ||
          (share
            ? resource === 'audio'
              ? share.job.filename
              : resource === 'transcript'
                ? buildDefaultFilename(share.job.filename, '_transcript.txt')
                : buildDefaultFilename(share.job.filename, '_summary.md')
            : 'download');

        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } catch (err) {
        console.error('Failed to download shared resource', err);
        const status = resolveHttpStatus(err);
        if (status === 403) {
          setError('分享者已禁用此项下载。');
        } else if (status === 401) {
          setError('提取码验证失败，请重新输入。');
          setAuthorizedCode(undefined);
          setShare(null);
          setRequiresCode(true);
        } else {
          setError('下载失败，请稍后重试。');
        }
      } finally {
        setDownloading(null);
      }
    },
    [authorizedCode, share, shareToken]
  );

  const summaryContent = useMemo(() => {
    if (!share) {
      return '';
    }
    const summary = share.job.summary ?? '';
    if (!summary.trim()) {
      return '';
    }

    try {
      const parsed = JSON.parse(summary);
      if (typeof parsed === 'string') {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.formatted_content === 'string' && parsed.formatted_content.trim()) {
          return parsed.formatted_content;
        }
        if (parsed.structured_data) {
          return JSON.stringify(parsed.structured_data, null, 2);
        }
      }
    } catch {
      // ignore, treat as plain markdown
    }

    return summary;
  }, [share]);

  return (
    <div className="container py-5">
      <div className="mb-4 text-center">
        <h1 className="mb-2">会议分享</h1>
        <p className="text-muted mb-0">查看与下载共享的会议音频、转录与摘要</p>
      </div>

      {loading && (
        <div className="text-center py-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      )}

      {!loading && requiresCode && !share && (
        <div className="row justify-content-center">
          <div className="col-md-6">
            <div className="card shadow-sm">
              <div className="card-body">
                <h5 className="card-title">请输入提取码</h5>
                <p className="text-muted">该分享链接已设置提取码，请输入后继续访问。</p>
                {error && <div className="alert alert-danger">{error}</div>}
                <form onSubmit={handleSubmitCode}>
                  <div className="mb-3">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="提取码"
                      value={codeInput}
                      onChange={e => setCodeInput(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={verificationLoading}>
                    {verificationLoading ? '验证中...' : '提交'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !requiresCode && error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {!loading && share && (
        <div className="row g-4">
          <div className="col-lg-4">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <h5 className="card-title">会议信息</h5>
                <p className="mb-1"><strong>文件名：</strong>{share.job.filename}</p>
                <p className="mb-1"><strong>创建时间：</strong>{new Date(share.job.created_at).toLocaleString()}</p>
                <p className="mb-1">
                  <strong>到期时间：</strong>
                  {share.expires_at ? new Date(share.expires_at).toLocaleString() : '长期有效'}
                </p>
                <p className="mb-3">
                  <strong>状态：</strong>
                  <span className="badge bg-info text-dark ms-1">{share.job.status}</span>
                </p>

                <div className="d-grid gap-2">
                  <button
                    className="btn btn-outline-primary"
                    onClick={() => handleDownload('audio')}
                    disabled={!share.permissions.allow_audio_download || downloading === 'audio'}
                  >
                    <i className="bi bi-file-earmark-music me-1"></i>
                    {downloading === 'audio' ? '下载中...' : '下载音频'}
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => handleDownload('transcript')}
                    disabled={!share.permissions.allow_transcript_download || downloading === 'transcript'}
                  >
                    <i className="bi bi-file-text me-1"></i>
                    {downloading === 'transcript' ? '下载中...' : '下载转录'}
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => handleDownload('summary')}
                    disabled={!share.permissions.allow_summary_download || downloading === 'summary'}
                  >
                    <i className="bi bi-file-richtext me-1"></i>
                    {downloading === 'summary' ? '下载中...' : '下载摘要'}
                  </button>
                </div>

                {share.requires_access_code && (
                  <p className="text-muted mt-3 mb-0">
                    提示：下次访问或下载时仍需提供提取码。
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="col-lg-8">
            <div className="card shadow-sm mb-4">
              <div className="card-body">
                <h5 className="card-title">会议摘要</h5>
                {summaryContent ? (
                  <div className="markdown-body">
                    <ReactMarkdown>{summaryContent}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-muted mb-0">暂无摘要内容。</p>
                )}
              </div>
            </div>

            <div className="card shadow-sm">
              <div className="card-body">
                <h5 className="card-title">会议转录</h5>
                {share.job.transcript ? (
                  <div className="transcript-content" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {share.job.transcript}
                  </div>
                ) : (
                  <p className="text-muted mb-0">暂无转录文本。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharePage;
