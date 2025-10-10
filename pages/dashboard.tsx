import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import Navbar from '../src/components/Navbar'
import CampaignForm from '../src/components/CampaignForm'
import { type User, verifySession } from '../src/lib/supabaseClient'

// Extend Window interface for polling interval
declare global {
  interface Window {
    activityPollingInterval?: NodeJS.Timeout
  }
}

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

interface Activity {
  id: string
  campaign_id: string
  campaign_name: string
  campaign_privacy: string
  user_id: string
  user_name: string
  user_email: string
  user_avatar?: string
  activity_type: string
  activity_data: any
  created_at: string
}

interface CampaignFormData {
  name: string
  description: string
  scope: string
  privacy: 'private' | 'public'
}

export default function CampaignDashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastActivityCheck, setLastActivityCheck] = useState<Date>(new Date())

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user, error } = await verifySession()
        if (user) {
          setUser(user)
          await Promise.all([
            fetchCampaigns(),
            fetchActivities()
          ])
          startActivityPolling()
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

    // Cleanup polling on unmount
    return () => {
      if (window.activityPollingInterval) {
        clearInterval(window.activityPollingInterval)
      }
    }
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

      const data = await response.json()

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

  const fetchActivities = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      const response = await fetch('/api/campaigns/activities', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setActivities(data.activities)
        setLastActivityCheck(new Date())
      } else {
        console.error('Failed to fetch activities:', data.error)
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error)
    }
  }

  const startActivityPolling = () => {
    // Poll for new activities every 30 seconds
    window.activityPollingInterval = setInterval(() => {
      fetchActivities()
    }, 30000)
  }

  const handleCreateCampaign = async (campaignData: CampaignFormData) => {
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

      const data = await response.json()

      if (data.success) {
        // Add the new campaign to the list
        setCampaigns(prev => [data.campaign, ...prev])
        setShowCreateForm(false)
        // Refresh activities to show the new campaign creation
        await fetchActivities()
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

  const getActivityIcon = (activityType: string) => {
    switch (activityType) {
      case 'campaign_created': return '🎯'
      case 'member_added': return '👥'
      case 'member_removed': return '👋'
      case 'observation_added': return '🔍'
      case 'finding_created': return '⚠️'
      case 'task_created': return '📋'
      case 'task_completed': return '✅'
      case 'message_sent': return '💬'
      default: return '📢'
    }
  }

  const getActivityMessage = (activity: Activity) => {
    const { activity_type, activity_data, user_name, campaign_name } = activity
    
    switch (activity_type) {
      case 'campaign_created':
        return `${user_name} created campaign "${campaign_name}"`
      case 'member_added':
        return `${user_name} added ${activity_data.member_name} as ${activity_data.member_role} to "${campaign_name}"`
      case 'member_removed':
        return `${user_name} removed ${activity_data.member_name} from "${campaign_name}"`
      case 'observation_added':
        return `${user_name} added observation "${activity_data.observation_title}" to "${campaign_name}"`
      case 'finding_created':
        return `${user_name} created finding "${activity_data.finding_title}" in "${campaign_name}"`
      case 'task_created':
        return `${user_name} created task "${activity_data.task_title}" in "${campaign_name}"`
      case 'task_completed':
        return `${user_name} completed task "${activity_data.task_title}" in "${campaign_name}"`
      case 'message_sent':
        return `${user_name} sent a message in "${campaign_name}"`
      default:
        return `${user_name} performed an action in "${campaign_name}"`
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const activityDate = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - activityDate.getTime()) / 1000)

    if (diffInSeconds < 60) return 'just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    return `${Math.floor(diffInSeconds / 86400)}d ago`
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
        <title>Campaign Dashboard - Bastet Console</title>
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
          <div className="dashboard-header">
            <div className="dashboard-header-content">
              <h1 className="dashboard-title">Campaign Dashboard</h1>
              <p className="dashboard-subtitle">
                Stay updated on your security assessment campaigns and team activities.
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
                />
              </div>
            </div>
          )}

          <div className="dashboard-grid">
            {/* Campaigns Section */}
            <div className="dashboard-section">
              <div className="section-header">
                <h2 className="section-title">Your Campaigns</h2>
                <span className="section-count">{campaigns.length}</span>
              </div>
              
              <div className="campaigns-list">
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
                  campaigns.slice(0, 5).map((campaign) => (
                    <div key={campaign.id} className="campaign-item">
                      <div className="campaign-item-content">
                        <div className="campaign-item-header">
                          <h3 className="campaign-item-title">
                            <Link href={`/campaigns/${campaign.id}`}>
                              {campaign.name}
                            </Link>
                          </h3>
                          <div className="campaign-item-badges">
                            <span className={`badge ${getStatusBadgeColor(campaign.status)}`}>
                              {campaign.status}
                            </span>
                            <span className={`badge ${getRoleBadgeColor(
                              campaign.campaign_members[0]?.role || 'watcher'
                            )}`}>
                              {campaign.campaign_members[0]?.role || 'watcher'}
                            </span>
                          </div>
                        </div>
                        {campaign.description && (
                          <p className="campaign-item-description">
                            {campaign.description}
                          </p>
                        )}
                        <div className="campaign-item-meta">
                          <span className="campaign-item-scope">
                            <strong>Scope:</strong> {campaign.scope}
                          </span>
                          <span className="campaign-item-members">
                            {campaign.campaign_members.length} member{campaign.campaign_members.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {campaigns.length > 5 && (
                <div className="section-footer">
                  <Link href="/campaigns" className="section-link">
                    View All Campaigns →
                  </Link>
                </div>
              )}
            </div>

            {/* Activity Feed Section */}
            <div className="dashboard-section">
              <div className="section-header">
                <h2 className="section-title">Activity Feed</h2>
                <div className="activity-status">
                  <span className="activity-indicator"></span>
                  <span className="activity-text">Live</span>
                </div>
              </div>
              
              <div className="activity-feed">
                {activities.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-content">
                      <div className="empty-state-icon">📢</div>
                      <h3 className="empty-state-title">No recent activity</h3>
                      <p className="empty-state-description">
                        Activity from your campaigns will appear here.
                      </p>
                    </div>
                  </div>
                ) : (
                  activities.slice(0, 10).map((activity) => (
                    <div key={activity.id} className="activity-item">
                      <div className="activity-item-content">
                        <div className="activity-icon">
                          {getActivityIcon(activity.activity_type)}
                        </div>
                        <div className="activity-details">
                          <p className="activity-message">
                            {getActivityMessage(activity)}
                          </p>
                          <div className="activity-meta">
                            <span className="activity-time">
                              {formatTimeAgo(activity.created_at)}
                            </span>
                            <span className="activity-campaign">
                              in {activity.campaign_name}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {activities.length > 10 && (
                <div className="section-footer">
                  <button className="section-link">
                    Load More Activity →
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
