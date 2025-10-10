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
}

export default function CampaignForm({ onSubmit, onCancel, loading = false }: CampaignFormProps) {
  const [formData, setFormData] = useState<CampaignData>({
    name: '',
    description: '',
    scope: '',
    privacy: 'private'
  })
  const [errors, setErrors] = useState<Partial<CampaignData>>({})

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
            rows={4}
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
    </div>
  )
}
