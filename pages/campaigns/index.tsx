import type { ApiResult } from '../../src/lib/apiResult'
import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import Navbar from '../../src/components/Navbar'
import CampaignForm, { type CampaignSubmission } from '../../src/components/CampaignForm'
import { type User, verifySession } from '../../src/lib/authClient'

interface Campaign {
  id: string
  name: string
  description?: string
  scope: string
  status: string
  privacy: string
  owner_id: string
  created_at: string
  updated_at: string
  campaign_members: Array<{
    role: string
    users: {
      id: string
      name: string
      email: string
      avatar_url?: string
    }
  }>
}

export default function CampaignsDashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user, error } = await verifySession()
        if (user) {
          setUser(user)
          await fetchCampaigns()
        } else {
          setError('Please sign in to access campaigns')
        }
      } catch (error) {
        console.error('Auth check failed:', error)
        setError('Authentication failed')
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [])

  const fetchCampaigns = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      const response = await fetch('/api/campaigns', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json() as ApiResult<{ campaigns: Campaign[] }>

      if (data.success) {
        setCampaigns(data.campaigns)
      } else {
        setError('Failed to fetch campaigns')
      }
    } catch (error) {
      console.error('Failed to fetch campaigns:', error)
      setError('Failed to fetch campaigns')
    }
  }

  const handleCreateCampaign = async (campaignData: CampaignSubmission) => {
    try {
      setCreating(true)
      setError(null)

      const token = localStorage.getItem('auth_token')
      if (!token) {
        setError('Authentication required')
        return
      }

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(campaignData)
      })

      const data = await response.json() as ApiResult<{ campaign: Campaign }>

      if (data.success) {
        // Add the new campaign to the list
        setCampaigns(prev => [data.campaign, ...prev])
        setShowCreateForm(false)
      } else {
        setError(data.error || 'Failed to create campaign')
      }
    } catch (error) {
      console.error('Campaign creation failed:', error)
      setError('Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-purple-100 text-purple-800'
      case 'manager': return 'bg-blue-100 text-blue-800'
      case 'collaborator': return 'bg-green-100 text-green-800'
      case 'watcher': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800'
      case 'paused': return 'bg-yellow-100 text-yellow-800'
      case 'completed': return 'bg-blue-100 text-blue-800'
      case 'archived': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Authentication Required</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link href="/" className="cta-button">
            Go to Homepage
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Campaigns - Bastet Console</title>
        <meta name="description" content="Manage your security assessment campaigns" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar 
          user={user} 
          onSignIn={() => window.location.href = '/'}
          onSignOut={async () => {
            await fetch('/api/auth/logout', { method: 'POST' })
            localStorage.removeItem('auth_token')
            window.location.href = '/'
          }}
        />
        
        <main className="container mx-auto px-4 py-8">
          <div className="campaigns-header">
            <div className="campaigns-header-content">
              <h1 className="campaigns-title">Security Campaigns</h1>
              <p className="campaigns-subtitle">
                Manage your security assessment campaigns and collaborate with your team.
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="cta-button"
              disabled={creating}
            >
              Create Campaign
            </button>
          </div>

          {error && (
            <div className="error-banner">
              <div className="error-content">
                <span className="error-icon">⚠️</span>
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="error-dismiss"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {showCreateForm && (
            <div className="modal-overlay">
              <div className="modal-content">
                <CampaignForm
                  onSubmit={handleCreateCampaign}
                  onCancel={() => setShowCreateForm(false)}
                  loading={creating}
                  submitError={error}
                />
              </div>
            </div>
          )}

          <div className="campaigns-grid">
            {campaigns.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-content">
                  <div className="empty-state-icon">🎯</div>
                  <h3 className="empty-state-title">No campaigns yet</h3>
                  <p className="empty-state-description">
                    Create your first security assessment campaign to get started.
                  </p>
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="cta-button"
                  >
                    Create Your First Campaign
                  </button>
                </div>
              </div>
            ) : (
              campaigns.map((campaign) => (
                <div key={campaign.id} className="campaign-card">
                  <div className="campaign-card-header">
                    <div className="campaign-card-title-section">
                      <h3 className="campaign-card-title">
                        <Link href={`/campaigns/${campaign.id}`}>
                          {campaign.name}
                        </Link>
                      </h3>
                      <div className="campaign-card-badges">
                        <span className={`badge ${getStatusBadgeColor(campaign.status)}`}>
                          {campaign.status}
                        </span>
                        <span className={`badge ${getRoleBadgeColor(
                          campaign.campaign_members[0]?.role || 'watcher'
                        )}`}>
                          {campaign.campaign_members[0]?.role || 'watcher'}
                        </span>
                        {campaign.privacy === 'public' && (
                          <span className="badge bg-orange-100 text-orange-800">
                            public
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {campaign.description && (
                    <p className="campaign-card-description">
                      {campaign.description}
                    </p>
                  )}

                  <div className="campaign-card-scope">
                    <strong>Scope:</strong> {campaign.scope}
                  </div>

                  <div className="campaign-card-footer">
                    <div className="campaign-card-meta">
                      <span className="campaign-card-date">
                        Created {formatDate(campaign.created_at)}
                      </span>
                      <span className="campaign-card-members">
                        {campaign.campaign_members.length} member{campaign.campaign_members.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="campaign-card-link"
                    >
                      View Details →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>
    </>
  )
}
