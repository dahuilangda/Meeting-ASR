import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Table, Badge, Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap';
import {
  JobShare,
  CreateJobSharePayload,
  UpdateJobSharePayload,
  listJobShares,
  createJobShare,
  updateJobShare,
  deactivateJobShare,
} from '../api';

interface ShareManagerModalProps {
  jobId: number;
  jobFilename: string;
  show: boolean;
  onClose: () => void;
}

interface ShareFormState {
  expiresInDays: string;
  allowAudioDownload: boolean;
  allowTranscriptDownload: boolean;
  allowSummaryDownload: boolean;
  accessCode: string;
}

const INITIAL_FORM_STATE: ShareFormState = {
  expiresInDays: '7',
  allowAudioDownload: false,
  allowTranscriptDownload: true,
  allowSummaryDownload: true,
  accessCode: '',
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const buildShareUrl = (token: string) => `${window.location.origin}/share/${token}`;

const ShareManagerModal: React.FC<ShareManagerModalProps> = ({ jobId, jobFilename, show, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [shares, setShares] = useState<JobShare[]>([]);
  const [formState, setFormState] = useState<ShareFormState>(INITIAL_FORM_STATE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!show) {
      setShares([]);
      setFormState(INITIAL_FORM_STATE);
      setError(null);
      setInfo(null);
      return;
    }

    let ignore = false;
    const fetchShares = async () => {
      setLoading(true);
      setError(null);
      try {
        const items = await listJobShares(jobId);
        if (!ignore) {
          setShares(items);
        }
      } catch (err) {
        console.error('Failed to fetch share links', err);
        if (!ignore) {
          setError('无法加载分享列表，请稍后重试。');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    fetchShares();
    return () => {
      ignore = true;
    };
  }, [jobId, show]);

  const handleClose = () => {
    onClose();
  };

  const validateForm = (): string | null => {
    if (formState.expiresInDays) {
      const days = Number.parseInt(formState.expiresInDays, 10);
      if (Number.isNaN(days) || days <= 0 || days > 365) {
        return '有效期天数必须是 1 到 365 之间的整数。';
      }
    }

    if (formState.accessCode && formState.accessCode.trim().length < 4) {
      return '提取码至少需要 4 个字符。';
    }

    return null;
  };

  const handleCreateShare = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationMessage = validateForm();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const payload: CreateJobSharePayload = {
      allow_audio_download: formState.allowAudioDownload,
      allow_transcript_download: formState.allowTranscriptDownload,
      allow_summary_download: formState.allowSummaryDownload,
    };

    if (formState.expiresInDays) {
      payload.expires_in_days = Number.parseInt(formState.expiresInDays, 10);
    }

    if (formState.accessCode.trim()) {
      payload.access_code = formState.accessCode.trim();
    }

    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const newShare = await createJobShare(jobId, payload);
      setShares(prev => [newShare, ...prev]);
      setFormState({
        ...INITIAL_FORM_STATE,
        allowAudioDownload: formState.allowAudioDownload,
        allowTranscriptDownload: formState.allowTranscriptDownload,
        allowSummaryDownload: formState.allowSummaryDownload,
      });
      setInfo('分享链接已创建，可复制链接发送给接收方。');
    } catch (err) {
      console.error('Failed to create share link', err);
      setError('创建分享链接失败，请稍后重试。');
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePermission = async (share: JobShare, field: keyof UpdateJobSharePayload, nextValue: boolean) => {
    try {
      const updated = await updateJobShare(jobId, share.id, { [field]: nextValue });
      setShares(prev => prev.map(item => (item.id === share.id ? updated : item)));
    } catch (err) {
      console.error('Failed to update share link', err);
      setError('更新权限失败，请稍后重试。');
    }
  };

  const handleRevokeShare = async (share: JobShare) => {
    if (!window.confirm('确定要停用这个分享链接吗？')) {
      return;
    }
    try {
      await deactivateJobShare(jobId, share.id);
      setShares(prev => prev.map(item => (item.id === share.id ? { ...item, is_active: false } : item)));
    } catch (err) {
      console.error('Failed to deactivate share link', err);
      setError('停用分享链接失败，请稍后重试。');
    }
  };

  const activeShares = useMemo(() => shares.filter(share => share.is_active), [shares]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setInfo('链接已复制到剪贴板。');
    } catch (err) {
      console.error('Failed to copy share link', err);
      setError('复制链接失败，请手动复制。');
    }
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>分享 “{jobFilename}”</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {info && <div className="alert alert-success mb-3">{info}</div>}

        <Form onSubmit={handleCreateShare} className="border rounded p-3 mb-4">
          <h6 className="mb-3">创建新的分享链接</h6>
          <div className="row g-3">
            <div className="col-md-4">
              <Form.Group controlId="shareExpiresInDays">
                <Form.Label>有效期（天）</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={365}
                  placeholder="30"
                  value={formState.expiresInDays}
                  onChange={e => setFormState(prev => ({ ...prev, expiresInDays: e.target.value }))}
                />
                <Form.Text className="text-muted">留空则长期有效</Form.Text>
              </Form.Group>
            </div>
            <div className="col-md-4 d-flex align-items-center">
              <Form.Group controlId="shareAllowAudio" className="mt-3 mt-md-0">
                <Form.Check
                  type="switch"
                  label="允许下载音频"
                  checked={formState.allowAudioDownload}
                  onChange={e => setFormState(prev => ({ ...prev, allowAudioDownload: e.target.checked }))}
                />
              </Form.Group>
            </div>
            <div className="col-md-4 d-flex align-items-center">
              <Form.Group controlId="shareAccessCode" className="w-100">
                <Form.Label>提取码（可选）</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="至少 4 位字符"
                  value={formState.accessCode}
                  onChange={e => setFormState(prev => ({ ...prev, accessCode: e.target.value }))}
                />
              </Form.Group>
            </div>
          </div>

          <div className="mt-3 d-flex flex-wrap gap-3">
            <Form.Check
              type="switch"
              id="shareAllowTranscript"
              label="允许下载转录文本"
              checked={formState.allowTranscriptDownload}
              onChange={e => setFormState(prev => ({ ...prev, allowTranscriptDownload: e.target.checked }))}
            />
            <Form.Check
              type="switch"
              id="shareAllowSummary"
              label="允许下载摘要"
              checked={formState.allowSummaryDownload}
              onChange={e => setFormState(prev => ({ ...prev, allowSummaryDownload: e.target.checked }))}
            />
          </div>

          <div className="mt-3">
            <Button type="submit" disabled={creating}>
              {creating ? <Spinner animation="border" size="sm" className="me-2" /> : <i className="bi bi-share me-2" />}
              创建分享链接
            </Button>
          </div>
        </Form>

        <h6 className="mb-3">已创建的分享链接</h6>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
          </div>
        ) : shares.length === 0 ? (
          <div className="text-muted">暂无分享链接。</div>
        ) : (
          <Table striped bordered hover responsive size="sm">
            <thead>
              <tr>
                <th>状态</th>
                <th>创建时间</th>
                <th>到期时间</th>
                <th>权限</th>
                <th>提取码</th>
                <th>访问记录</th>
                <th className="text-end">操作</th>
              </tr>
            </thead>
            <tbody>
              {shares.map(share => {
                const shareUrl = buildShareUrl(share.share_token);
                return (
                  <tr key={share.id} className={!share.is_active ? 'table-secondary' : undefined}>
                    <td>
                      {share.is_active ? <Badge bg="success">启用</Badge> : <Badge bg="secondary">已停用</Badge>}
                    </td>
                    <td>{formatDateTime(share.created_at)}</td>
                    <td>{formatDateTime(share.expires_at)}</td>
                    <td>
                      <div className="d-flex flex-column gap-2">
                        <OverlayTrigger placement="top" overlay={<Tooltip>允许下载音频</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`audio-${share.id}`}
                            label="音频"
                            checked={share.allow_audio_download}
                            disabled={!share.is_active}
                            onChange={e => handleTogglePermission(share, 'allow_audio_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>允许下载转录文本</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`transcript-${share.id}`}
                            label="转录"
                            checked={share.allow_transcript_download}
                            disabled={!share.is_active}
                            onChange={e => handleTogglePermission(share, 'allow_transcript_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>允许下载摘要内容</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`summary-${share.id}`}
                            label="摘要"
                            checked={share.allow_summary_download}
                            disabled={!share.is_active}
                            onChange={e => handleTogglePermission(share, 'allow_summary_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                      </div>
                    </td>
                    <td>{share.requires_access_code ? '已设置' : '未设置'}</td>
                    <td>
                      <div className="d-flex flex-column">
                        <span>次数：{share.access_count ?? 0}</span>
                        <span>最后访问：{formatDateTime(share.last_accessed_at)}</span>
                      </div>
                    </td>
                    <td className="text-end">
                      <div className="d-flex justify-content-end gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => copyToClipboard(shareUrl)}
                          title="复制分享链接"
                        >
                          <i className="bi bi-clipboard" />
                        </Button>
                        {share.is_active && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleRevokeShare(share)}
                          >
                            停用
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {activeShares.length > 0 && (
          <div className="alert alert-info mt-3 mb-0" role="alert">
            分享链接示例：<span className="fw-bold">{buildShareUrl(activeShares[0].share_token)}</span>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>
          关闭
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ShareManagerModal;
