import type { ApiResult } from '../lib/apiResult'
import React, { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import HackerOneScopeSnapshot, { type HackerOneMetadata } from './HackerOneScopeSnapshot'
import ProgramSetupPlan from './ProgramSetupPlan'

interface CampaignFormProps {
  onSubmit: (campaignData: CampaignSubmission) => Promise<void>
  onCancel: () => void
  loading?: boolean
  submitError?: string | null
}

export type CampaignSubmission = CampaignData | {
  privacy: 'private'
  status: 'paused'
  hackerone_handle: string
  hackerone_metadata: { scope_snapshot: { sha256: string } }
}

interface CampaignData {
  name: string
  description: string
  scope: string
  privacy: 'private' | 'public'
  status?: 'paused'
  rulesOfEngagement?: string
  hackerone_handle?: string
  hackerone_metadata?: HackerOneMetadata
}

interface IntegrationStatus { configured: boolean; authorized: boolean }
interface ProgramCandidate { handle: string; name: string; url: string }
type ImportResult = { campaign: CampaignData } | { candidates: ProgramCandidate[] }

type CreationMode = 'manual' | 'hackerone'

export default function CampaignForm({ onSubmit, onCancel, loading = false, submitError }: CampaignFormProps) {
  const [mode, setMode] = useState<CreationMode>('hackerone')
  const [hackeroneHandle, setHackeroneHandle] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null)
  const [checkingIntegration, setCheckingIntegration] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [programCandidates, setProgramCandidates] = useState<ProgramCandidate[] | null>(null)
  
  const [formData, setFormData] = useState<CampaignData>({
    name: '',
    description: '',
    scope: '',
    privacy: 'private'
  })
  const [errors, setErrors] = useState<Partial<Record<keyof CampaignData | 'review', string>>>({})
  const imported = Boolean(formData.hackerone_handle)
  const snapshot = formData.hackerone_metadata?.scope_snapshot

  useEffect(() => {
    if (mode !== 'hackerone') return
    let current = true
    setCheckingIntegration(true)
    setIntegrationStatus(null)
    setImportError(null)
    const checkIntegration = async () => {
      try {
        const token = localStorage.getItem('auth_token')
        if (!token) throw new Error('Sign in to the console before importing a program.')
        const response = await fetch('/api/integrations/hackerone', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
        })
        const data = await response.json() as ApiResult<IntegrationStatus>
        if (!response.ok || !data.success) throw new Error(!data.success && data.error || 'Could not check the HackerOne connection.')
        if (current) setIntegrationStatus(data)
      } catch (error) {
        if (current) setImportError(error instanceof Error ? error.message : 'Could not check the HackerOne connection.')
      } finally {
        if (current) setCheckingIntegration(false)
      }
    }
    void checkIntegration()
    return () => { current = false }
  }, [mode])

  const handleImportFromHackerOne = async (selectedHandle?: string) => {
    if (!selectedHandle && !hackeroneHandle.trim()) {
      setImportError('Please enter a program name, handle, or HackerOne URL')
      return
    }

    setImporting(true)
    setImportError(null)
    if (!selectedHandle) setProgramCandidates(null)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) throw new Error('Sign in to the console before importing a program.')
      const response = await fetch('/api/integrations/hackerone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(selectedHandle ? { programHandle: selectedHandle } : { programQuery: hackeroneHandle.trim() })
      })

      const data = await response.json() as ApiResult<ImportResult>

      if (response.ok && data.success) {
        if ('candidates' in data) {
          setProgramCandidates(data.candidates)
          return
        }
        // Populate form with imported data including HackerOne metadata
        setFormData({
          name: data.campaign.name,
          description: data.campaign.description,
          scope: data.campaign.scope,
          privacy: 'private',
          status: 'paused',
          rulesOfEngagement: data.campaign.rulesOfEngagement,
          hackerone_handle: data.campaign.hackerone_handle,
          hackerone_metadata: data.campaign.hackerone_metadata
        })
        setReviewed(false)
        setProgramCandidates(null)
        setErrors({})
        setMode('manual') // Switch to manual mode with pre-filled data
      } else {
        setImportError(!data.success && data.error || 'Failed to import program from HackerOne')
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to connect to HackerOne. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof CampaignData | 'review', string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Campaign name is required'
    } else if (formData.name.length > 255) {
      newErrors.name = 'Campaign name must be 255 characters or less'
    }

    if (!formData.scope.trim()) {
      newErrors.scope = 'Campaign scope is required'
    }
    if (imported && (!snapshot || !reviewed)) newErrors.review = 'Review the saved policy and exclusions before creating this paused campaign.'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onSubmit(imported && snapshot ? {
        privacy: 'private',
        status: 'paused',
        hackerone_handle: formData.hackerone_handle!,
        hackerone_metadata: { scope_snapshot: { sha256: snapshot.sha256 } }
      } : formData)
    } catch (error) {
      console.error('Campaign creation failed:', error)
    }
  }

  const handleInputChange = (field: keyof CampaignData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <div className="campaign-form-container">
      <div className="campaign-form-header">
        <h2>Create New Campaign</h2>
        <p>Set up a new security assessment campaign with scope and team members.</p>
      </div>

      {/* Mode Selection */}
      <div className="campaign-mode-selector">
        <button
          type="button"
          className={clsx('mode-button', { active: mode === 'manual' })}
          onClick={() => setMode('manual')}
          disabled={loading || importing}
        >
          <span className="mode-icon">✏️</span>
          <div className="mode-text">
            <strong>{imported ? 'Review Import' : 'Manual Entry'}</strong>
            <small>{imported ? 'Review imported campaign' : 'Create campaign from scratch'}</small>
          </div>
        </button>
        <button
          type="button"
          className={clsx('mode-button', { active: mode === 'hackerone' })}
          onClick={() => setMode('hackerone')}
          disabled={loading || importing}
        >
          <span className="mode-icon">🔗</span>
          <div className="mode-text">
            <strong>Import from HackerOne</strong>
            <small>Find a program by name</small>
          </div>
        </button>
      </div>

      {/* HackerOne Import Section */}
      {mode === 'hackerone' && (
        <div className="hackerone-import-section">
          <div className="import-header">
            <h3>Import from HackerOne</h3>
            <p>Enter a program name, handle, or URL. The local console backend looks up programs accessible to your HackerOne account, including private invitations, then prepares the full scope and a proposed tool setup for your review.</p>
          </div>
          <div className="import-info" role="status">
            {checkingIntegration ? <p>Checking the server-side HackerOne connection...</p> : integrationStatus?.configured && integrationStatus.authorized ? <p>Server-side HackerOne connection ready. No API key is sent to this browser.</p> : integrationStatus && !integrationStatus.configured ? <p>HackerOne is not configured on this backend. Provision credentials only on the local console backend and use it to import programs; saved scope is also visible here. Do not paste credentials into this form.</p> : integrationStatus && !integrationStatus.authorized ? <p>This console account is not authorized to use the server-side HackerOne integration. Sign in as the configured owner or ask the administrator to review access.</p> : <p>Connection status unavailable. Switch away and back to retry, or sign in again.</p>}
          </div>
          
          <div className="import-input-group">
            <label htmlFor="hackerone-handle" className="form-label">
              Program name, handle, or HackerOne URL
            </label>
            <div className="import-input-wrapper">
              <input
                id="hackerone-handle"
                type="text"
                value={hackeroneHandle}
                onChange={(e) => {
                  setHackeroneHandle(e.target.value)
                  setImportError(null)
                  setProgramCandidates(null)
                }}
                className="form-input"
                placeholder="Program name or https://hackerone.com/program-handle"
                disabled={importing || loading}
              />
              <button
                type="button"
                onClick={() => handleImportFromHackerOne()}
                className={clsx('import-button', { 'form-button-loading': importing })}
                disabled={loading || importing || checkingIntegration || !integrationStatus?.configured || !integrationStatus.authorized || !hackeroneHandle.trim()}
              >
                {importing ? 'Looking up...' : 'Find Program'}
              </button>
            </div>
            {importError && (
              <span className="form-error">{importError}</span>
            )}
            <div className="form-help">
              Private invitations are account-specific. A browser invitation alone does not grant the server account access.
              {' '}If name lookup exceeds the account catalog limits, paste the exact program URL.
            </div>
          </div>

          {programCandidates && (
            <section className="hackerone-program-candidates" aria-label="Choose a HackerOne program">
              <h4>{programCandidates.length ? 'Choose the intended program' : 'No accessible programs matched'}</h4>
              <p className="form-help">{programCandidates.length ? 'These matches need your choice. Confirm the exact program below before importing its scope.' : 'Try the exact HackerOne handle or program URL. The server account must have access to a private program.'}</p>
              {programCandidates.map(candidate => (
                <button type="button" key={candidate.handle} className="hackerone-program-candidate" disabled={loading || importing} onClick={() => handleImportFromHackerOne(candidate.handle)}>
                  <strong>{candidate.name}</strong>
                  <span>hackerone.com/{candidate.handle}</span>
                  <span>Review this program →</span>
                </button>
              ))}
            </section>
          )}

          <div className="import-info">
            <p><strong>What will be imported:</strong></p>
            <ul>
              <li>Program name and description</li>
              <li>All structured scope pages, explicit exclusions, and full asset notes</li>
              <li>Full API policy, submission and bounty eligibility, and severity limits</li>
              <li>A timestamped SHA-256 snapshot, verified again before saving</li>
              <li>A private, paused campaign. Importing does not start any testing.</li>
              <li>A proposed setup grouped by target type, including prerequisites and tools</li>
            </ul>
          </div>
          <div className="form-actions">
            <button type="button" className="form-button form-button-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
          </div>
        </div>
      )}

      {/* Manual Entry Form */}
      {mode === 'manual' && (
        <form onSubmit={handleSubmit} className="campaign-form">
          {submitError && <div className="form-error" role="alert">{submitError}{imported && ' Re-import the program to review its current snapshot before trying again.'}</div>}
          <div className="form-group">
            <label htmlFor="campaign-name" className="form-label">
              Campaign Name *
            </label>
            <input
              id="campaign-name"
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className={clsx('form-input', { 'form-input-error': errors.name })}
              placeholder="e.g., Q4 2024 Security Assessment"
              disabled={loading || imported}
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="campaign-description" className="form-label">
              Description
            </label>
            <textarea
              id="campaign-description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              className="form-textarea"
              placeholder="Describe the purpose and objectives of this campaign..."
              rows={4}
              disabled={loading || imported}
            />
          </div>

          <div className="form-group">
            <label htmlFor="campaign-scope" className="form-label">
              Scope *
            </label>
            <textarea
              id="campaign-scope"
              value={formData.scope}
              onChange={(e) => handleInputChange('scope', e.target.value)}
              className={clsx('form-textarea', { 'form-input-error': errors.scope })}
              placeholder="Define the target scope for this campaign (e.g., IP ranges, domains, applications)..."
              rows={6}
              disabled={loading || imported}
            />
            {errors.scope && <span className="form-error">{errors.scope}</span>}
            <div className="form-help">
              {imported ? 'Imported scope is kept unchanged so the server can verify the snapshot before saving.' : 'Be specific about what systems, networks, or applications will be assessed.'}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="campaign-privacy" className="form-label">
              Privacy Setting
            </label>
            <div className="form-radio-group">
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="privacy"
                  value="private"
                  checked={formData.privacy === 'private'}
                  onChange={(e) => handleInputChange('privacy', e.target.value)}
                  disabled={loading || imported}
                />
                <span className="form-radio-text">
                  <strong>Private</strong>
                  <small>Only campaign members can view and access</small>
                </span>
              </label>
              <label className="form-radio-label">
                <input
                  type="radio"
                  name="privacy"
                  value="public"
                  checked={formData.privacy === 'public'}
                  onChange={(e) => handleInputChange('privacy', e.target.value)}
                  disabled={loading || imported}
                />
                <span className="form-radio-text">
                  <strong>Public</strong>
                  <small>Visible to all users in the organization</small>
                </span>
              </label>
            </div>
            {imported && <p className="form-help">HackerOne imports stay private and start paused. Do not share private-program details with uninvited collaborators.</p>}
          </div>

          {imported && (
            <div className="form-group">
              {snapshot && <ProgramSetupPlan key={snapshot.sha256} snapshot={snapshot} />}
              {snapshot && <HackerOneScopeSnapshot snapshot={snapshot} />}
              <p className="form-help">Also manually review the program&apos;s <a href={`https://hackerone.com/${encodeURIComponent(formData.hackerone_handle!)}/invite_only`} target="_blank" rel="noopener noreferrer">private-program rules</a>, <a href={`https://hackerone.com/${encodeURIComponent(formData.hackerone_handle!)}/updates`} target="_blank" rel="noopener noreferrer">updates and announcements</a>, and <a href="https://docs.hackerone.com/en/articles/8494488-core-ineligible-findings" target="_blank" rel="noopener noreferrer">core ineligible findings</a>. The API snapshot does not verify your review of these pages.</p>
              <label className="hackerone-review-check">
                <input type="checkbox" checked={reviewed} disabled={loading} onChange={event => { setReviewed(event.target.checked); setErrors(prev => ({ ...prev, review: undefined })) }} />
                <span>I reviewed the policy, in-scope notes, and exclusions. I understand this creates a private, paused campaign, not permission to test or validation of a runner&apos;s scope enforcement.</span>
              </label>
              {errors.review && <span className="form-error" role="alert">{errors.review}</span>}
            </div>
          )}

          <div className="form-actions">
            <button
              type="button"
              onClick={onCancel}
              className="form-button form-button-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={clsx('form-button form-button-primary', { 'form-button-loading': loading })}
              disabled={loading || (imported && (!reviewed || !snapshot))}
            >
              {loading ? 'Creating...' : imported ? 'Create Private Paused Campaign' : 'Create Campaign'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
