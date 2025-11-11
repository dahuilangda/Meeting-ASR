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
  deleteJobShare,
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
  const [actionShareId, setActionShareId] = useState<number | null>(null);

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
          setError('Failed to load share links. Please try again later.');
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
        return 'Expiration must be an integer between 1 and 365 days.';
      }
    }

    if (formState.accessCode && formState.accessCode.trim().length < 4) {
      return 'Access code must contain at least 4 characters.';
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
      setInfo('Share link created. Copy and send it to your recipient.');
    } catch (err) {
      console.error('Failed to create share link', err);
      setError('Failed to create share link. Please try again later.');
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePermission = async (share: JobShare, field: keyof UpdateJobSharePayload, nextValue: boolean) => {
    if (actionShareId !== null) {
      return;
    }
    setInfo(null);
    setError(null);
    try {
      const updated = await updateJobShare(jobId, share.id, { [field]: nextValue });
      setShares(prev => prev.map(item => (item.id === share.id ? updated : item)));
    } catch (err) {
      console.error('Failed to update share link', err);
      setError('Failed to update permissions. Please try again later.');
    }
  };

  const handleRevokeShare = async (share: JobShare) => {
    if (!window.confirm('Are you sure you want to deactivate this share link?')) {
      return;
    }
    setInfo(null);
    setError(null);
    setActionShareId(share.id);
    try {
      await deactivateJobShare(jobId, share.id);
      setShares(prev => prev.map(item => (item.id === share.id ? { ...item, is_active: false } : item)));
      setInfo('Share link deactivated.');
    } catch (err) {
      console.error('Failed to deactivate share link', err);
      setError('Failed to deactivate share link. Please try again later.');
    } finally {
      setActionShareId(null);
    }
  };

  const handleDeleteShare = async (share: JobShare) => {
    if (!window.confirm('This will permanently delete the share link. Continue?')) {
      return;
    }
    setInfo(null);
    setError(null);
    setActionShareId(share.id);
    try {
      await deleteJobShare(jobId, share.id);
      setShares(prev => prev.filter(item => item.id !== share.id));
      setInfo('Share link deleted.');
    } catch (err) {
      console.error('Failed to delete share link', err);
      setError('Failed to delete share link. Please try again later.');
    } finally {
      setActionShareId(null);
    }
  };

  const activeShares = useMemo(() => shares.filter(share => share.is_active), [shares]);

  const copyToClipboard = async (text: string) => {
    setInfo(null);
    setError(null);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function' && window.isSecureContext) {
        await clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);

        const selection = document.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (range && selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }

        if (!copied) {
          throw new Error('execCommand returned false');
        }
      }
      setInfo('Link copied to clipboard.');
    } catch (err) {
      console.error('Failed to copy share link', err);
      if (!window.isSecureContext) {
        setError('Clipboard access requires HTTPS. Please copy the link manually.');
      } else {
        setError('Failed to copy the link. Please copy it manually.');
      }
    }
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Share "{jobFilename}"</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {info && <div className="alert alert-success mb-3">{info}</div>}

        <Form onSubmit={handleCreateShare} className="border rounded p-3 mb-4">
          <h6 className="mb-3">Create a New Share Link</h6>
          <div className="row g-3">
            <div className="col-md-4">
              <Form.Group controlId="shareExpiresInDays">
                <Form.Label>Expires In (Days)</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={365}
                  placeholder="30"
                  value={formState.expiresInDays}
                  onChange={e => setFormState(prev => ({ ...prev, expiresInDays: e.target.value }))}
                />
                <Form.Text className="text-muted">Leave blank for no expiration.</Form.Text>
              </Form.Group>
            </div>
            <div className="col-md-4 d-flex align-items-center">
              <Form.Group controlId="shareAllowAudio" className="mt-3 mt-md-0">
                <Form.Check
                  type="switch"
                  label="Allow audio download"
                  checked={formState.allowAudioDownload}
                  onChange={e => setFormState(prev => ({ ...prev, allowAudioDownload: e.target.checked }))}
                />
              </Form.Group>
            </div>
            <div className="col-md-4 d-flex align-items-center">
              <Form.Group controlId="shareAccessCode" className="w-100">
                <Form.Label>Access Code (Optional)</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Minimum 4 characters"
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
              label="Allow transcript download"
              checked={formState.allowTranscriptDownload}
              onChange={e => setFormState(prev => ({ ...prev, allowTranscriptDownload: e.target.checked }))}
            />
            <Form.Check
              type="switch"
              id="shareAllowSummary"
              label="Allow summary download"
              checked={formState.allowSummaryDownload}
              onChange={e => setFormState(prev => ({ ...prev, allowSummaryDownload: e.target.checked }))}
            />
          </div>

          <div className="mt-3">
            <Button type="submit" disabled={creating}>
              {creating ? <Spinner animation="border" size="sm" className="me-2" /> : <i className="bi bi-share me-2" />}
              Create Share Link
            </Button>
          </div>
        </Form>

        <h6 className="mb-3">Existing Share Links</h6>
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
          </div>
        ) : shares.length === 0 ? (
          <div className="text-muted">No share links yet.</div>
        ) : (
          <Table striped bordered hover responsive size="sm">
            <thead>
              <tr>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Permissions</th>
                <th>Access Code</th>
                <th>Usage</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shares.map(share => {
                const shareUrl = buildShareUrl(share.share_token);
                return (
                  <tr key={share.id} className={!share.is_active ? 'table-secondary' : undefined}>
                    <td>
                      {share.is_active ? <Badge bg="success">Active</Badge> : <Badge bg="secondary">Inactive</Badge>}
                    </td>
                    <td>{formatDateTime(share.created_at)}</td>
                    <td>{formatDateTime(share.expires_at)}</td>
                    <td>
                      <div className="d-flex flex-column gap-2">
                        <OverlayTrigger placement="top" overlay={<Tooltip>Allow audio download</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`audio-${share.id}`}
                            label="Audio"
                            checked={share.allow_audio_download}
                            disabled={!share.is_active || actionShareId !== null}
                            onChange={e => handleTogglePermission(share, 'allow_audio_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Allow transcript download</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`transcript-${share.id}`}
                            label="Transcript"
                            checked={share.allow_transcript_download}
                            disabled={!share.is_active || actionShareId !== null}
                            onChange={e => handleTogglePermission(share, 'allow_transcript_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<Tooltip>Allow summary download</Tooltip>}>
                          <Form.Check
                            type="switch"
                            id={`summary-${share.id}`}
                            label="Summary"
                            checked={share.allow_summary_download}
                            disabled={!share.is_active || actionShareId !== null}
                            onChange={e => handleTogglePermission(share, 'allow_summary_download', e.target.checked)}
                          />
                        </OverlayTrigger>
                      </div>
                    </td>
                    <td>{share.requires_access_code ? 'Set' : 'Not set'}</td>
                    <td>
                      <div className="d-flex flex-column">
                        <span>Views: {share.access_count ?? 0}</span>
                        <span>Last visited: {formatDateTime(share.last_accessed_at)}</span>
                      </div>
                    </td>
                    <td className="text-end">
                      <div className="d-flex justify-content-end gap-2">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => copyToClipboard(shareUrl)}
                          title="Copy share link"
                        >
                          <i className="bi bi-clipboard" />
                        </Button>
                        {share.is_active && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleRevokeShare(share)}
                            disabled={actionShareId !== null}
                          >
                            Deactivate
                          </Button>
                        )}
                        {!share.is_active && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteShare(share)}
                            disabled={actionShareId !== null}
                            title="Permanently delete this share link"
                          >
                            <i className="bi bi-trash" />
                          </Button>
                        )}
                        {share.is_active && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteShare(share)}
                            disabled={actionShareId !== null}
                            title="Delete immediately without deactivating first"
                          >
                            <i className="bi bi-trash" />
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
            Sample share link: <span className="fw-bold">{buildShareUrl(activeShares[0].share_token)}</span>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ShareManagerModal;
