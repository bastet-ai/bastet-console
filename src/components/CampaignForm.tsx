import type { ApiResult } from '../lib/apiResult'
import { useState } from 'react'
import { clsx } from 'clsx'

interface CampaignFormProps {
  onSubmit: (campaignData: CampaignData) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

interface CampaignData {
  name: string
  description: string
  scope: string
  privacy: 'private' | 'public'
  hackerone_handle?: string
  hackerone_metadata?: any
}

type CreationMode = 'manual' | 'hackerone'

export default function CampaignForm({ onSubmit, onCancel, loading = false }: CampaignFormProps) {
  const [mode, setMode] = useState<CreationMode>('manual')
  const [hackeroneHandle, setHackeroneHandle] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState<CampaignData>({
    name: '',
    description: '',
    scope: '',
    privacy: 'private'
  })
  const [errors, setErrors] = useState<Partial<CampaignData>>({})

  const handleImportFromHackerOne = async () => {
    if (!hackeroneHandle.trim()) {
      setImportError('Please enter a HackerOne program handle')
      return
    }

    setImporting(true)
    setImportError(null)

    try {
      const response = await fetch('/api/integrations/hackerone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ programHandle: hackeroneHandle.trim() })
      })

      const data = await response.json() as ApiResult<{ campaign: CampaignData }>

      if (data.success) {
        // Populate form with imported data including HackerOne metadata
        setFormData({
          name: data.campaign.name,
          description: data.campaign.description,
          scope: data.campaign.scope,
          privacy: 'private', // Default to private
          hackerone_handle: data.campaign.hackerone_handle,
          hackerone_metadata: data.campaign.hackerone_metadata
        })
        setMode('manual') // Switch to manual mode with pre-filled data
      } else {
        setImportError(data.error || 'Failed to import program from HackerOne')
      }
    } catch (error) {
      console.error('Import error:', error)
      setImportError('Failed to connect to HackerOne. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Partial<CampaignData> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Campaign name is required'
    } else if (formData.name.length > 255) {
      newErrors.name = 'Campaign name must be 255 characters or less'
    }

    if (!formData.scope.trim()) {
      newErrors.scope = 'Campaign scope is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onSubmit(formData)
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
            <strong>Manual Entry</strong>
            <small>Create campaign from scratch</small>
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
            <small>Import program scope and details</small>
          </div>
        </button>
      </div>

      {/* HackerOne Import Section */}
      {mode === 'hackerone' && (
        <div className="hackerone-import-section">
          <div className="import-header">
            <h3>Import from HackerOne</h3>
            <p>Enter a HackerOne program handle to import scope and rules of engagement.</p>
          </div>
          
          <div className="import-input-group">
            <label htmlFor="hackerone-handle" className="form-label">
              HackerOne Program Handle
            </label>
            <div className="import-input-wrapper">
              <input
                id="hackerone-handle"
                type="text"
                value={hackeroneHandle}
                onChange={(e) => {
                  setHackeroneHandle(e.target.value)
                  setImportError(null)
                }}
                className="form-input"
                placeholder="e.g., security, github, shopify"
                disabled={importing}
              />
              <button
                type="button"
                onClick={handleImportFromHackerOne}
                className={clsx('import-button', { 'form-button-loading': importing })}
                disabled={importing || !hackeroneHandle.trim()}
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
            {importError && (
              <span className="form-error">{importError}</span>
            )}
            <div className="form-help">
              Examples: security (HackerOne), github (GitHub), shopify (Shopify), coinbase (Coinbase)
            </div>
          </div>

          <div className="import-info">
            <p><strong>What will be imported:</strong></p>
            <ul>
              <li>Program name and description</li>
              <li>In-scope assets and targets</li>
              <li>Rules of engagement (policy)</li>
              <li>Asset types and severity guidelines</li>
            </ul>
          </div>
        </div>
      )}

      {/* Manual Entry Form */}
      {mode === 'manual' && (
        <form onSubmit={handleSubmit} className="campaign-form">
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
              disabled={loading}
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
              disabled={loading}
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
              disabled={loading}
            />
            {errors.scope && <span className="form-error">{errors.scope}</span>}
            <div className="form-help">
              Be specific about what systems, networks, or applications will be assessed.
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
                  disabled={loading}
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
                  disabled={loading}
                />
                <span className="form-radio-text">
                  <strong>Public</strong>
                  <small>Visible to all users in the organization</small>
                </span>
              </label>
            </div>
          </div>

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
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
