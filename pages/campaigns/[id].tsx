import type { ApiResult } from '../../src/lib/apiResult'
import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Navbar from '../../src/components/Navbar'
import HackerOneScopeSnapshot, { type HackerOneMetadata, type HackerOneScopeSnapshotData } from '../../src/components/HackerOneScopeSnapshot'
import { type User, verifySession } from '../../src/lib/authClient'

interface CampaignMember {
  id: string
  role: string
  joined_at: string
  users: {
    id: string
    name: string
    email: string
    avatar_url?: string
  }
}

interface Node {
  id: string
  name: string
  description?: string
  node_type: string
  status: string
  info?: any
  last_seen?: string
  websocket_connection: boolean
  created_at: string
  updated_at: string
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
  hackerone_handle?: string
  hackerone_last_synced?: string
  hackerone_metadata?: HackerOneMetadata
  rules_of_engagement?: string
  userRole: string
  campaign_members: CampaignMember[]
}

interface SyncPreview {
  sha256: string
  previous_sha256: string | null
  changed: boolean
  scope: string
  policy: string
  scope_snapshot: HackerOneScopeSnapshotData
}

export default function CampaignDetail() {
  const router = useRouter()
  const { id } = router.query
  
  const [user, setUser] = useState<User | null>(null)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null)
  const [syncReviewed, setSyncReviewed] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'observations' | 'findings' | 'tasks' | 'nodes' | 'chat'>('overview')

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user, error } = await verifySession()
        if (user) {
          setUser(user)
          if (id) {
            await Promise.all([
              fetchCampaign(),
              fetchNodes()
            ])
          }
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
  }, [id])

  const fetchCampaign = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      const response = await fetch(`/api/campaigns/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json() as ApiResult<{ campaign: Campaign }>

      if (data.success) {
        setCampaign(data.campaign)
      } else {
        setError(data.error || 'Failed to fetch campaign')
      }
    } catch (error) {
      console.error('Failed to fetch campaign:', error)
      setError('Failed to fetch campaign')
    }
  }

  const fetchNodes = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) return

      const response = await fetch('/api/nodes', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json() as { nodes?: Node[]; error?: string }

      if (data.nodes) {
        setNodes(data.nodes)
      } else {
        console.error('Failed to fetch nodes:', data.error)
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error)
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

  const getNodeStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-100 text-green-800'
      case 'offline': return 'bg-gray-100 text-gray-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getNodeTypeBadgeColor = (nodeType: string) => {
    switch (nodeType) {
      case 'scanner': return 'bg-blue-100 text-blue-800'
      case 'monitor': return 'bg-purple-100 text-purple-800'
      case 'analyzer': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const canManageCampaign = () => {
    return campaign?.userRole && ['owner', 'manager'].includes(campaign.userRole)
  }

  const canCreateContent = () => {
    return campaign?.userRole && ['owner', 'manager', 'collaborator'].includes(campaign.userRole)
  }

  const handleSync = async (accept = false) => {
    if (!campaign?.id || !campaign.hackerone_handle) return
    if (accept && (!syncPreview || !syncReviewed)) return

    setSyncing(true)
    setSyncError(null)
    setSyncMessage(null)

    try {
      const token = localStorage.getItem('auth_token')
      if (!token) throw new Error('Sign in before checking program changes.')
      const response = await fetch('/api/campaigns/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(accept && syncPreview ? {
          campaignId: campaign.id,
          expectedSha256: syncPreview.sha256,
          previousSha256: syncPreview.previous_sha256
        } : { campaignId: campaign.id })
      })

      const data = await response.json() as ApiResult<{ campaign: Partial<Campaign>; preview?: SyncPreview; message?: string }>

      if (response.ok && data.success) {
        setCampaign({ ...campaign, ...data.campaign })
        setSyncPreview(data.preview ?? null)
        setSyncReviewed(false)
        setSyncMessage(data.preview ? 'Latest snapshot retrieved for review. Nothing has been saved.' : data.message || 'Reviewed snapshot saved. A changed scope or policy pauses the campaign.')
      } else {
        setSyncError(!data.success && data.error || 'Failed to sync campaign')
        if (response.status === 409) {
          setSyncPreview(null)
          setSyncReviewed(false)
        }
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Failed to sync campaign. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  const formatSyncStatus = () => {
    if (!campaign?.hackerone_handle) return null
    if (!campaign.hackerone_last_synced) return 'Never synced'
    
    const syncDate = new Date(campaign.hackerone_last_synced)
    const now = new Date()
    const diffMs = now.getTime() - syncDate.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffHours < 1) return 'Synced less than an hour ago'
    if (diffHours < 24) return `Synced ${Math.floor(diffHours)} hour${Math.floor(diffHours) > 1 ? 's' : ''} ago`
    if (diffDays < 30) return `Synced ${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    
    return `Last synced: ${formatDate(campaign.hackerone_last_synced)}`
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

  if (error && !campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Campaign Not Found</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link href="/campaigns" className="cta-button">
            Back to Campaigns
          </Link>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>{campaign.name} - Bastet Console</title>
        <meta name="description" content={`Campaign: ${campaign.name}`} />
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
          {/* Campaign Header */}
          <div className="campaign-header">
            <div className="campaign-header-content">
              <div className="campaign-header-top">
                <Link href="/campaigns" className="campaign-back-link">
                  ← Back to Campaigns
                </Link>
                <div className="campaign-header-badges">
                  <span className={`badge ${getStatusBadgeColor(campaign.status)}`}>
                    {campaign.status}
                  </span>
                  <span className={`badge ${getRoleBadgeColor(campaign.userRole)}`}>
                    {campaign.userRole}
                  </span>
                  {campaign.privacy === 'public' && (
                    <span className="badge bg-orange-100 text-orange-800">
                      public
                    </span>
                  )}
                </div>
              </div>
              <h1 className="campaign-title">{campaign.name}</h1>
              {campaign.description && (
                <p className="campaign-description">{campaign.description}</p>
              )}
            </div>
            {canManageCampaign() && (
              <div className="campaign-header-actions">
                <button className="form-button form-button-secondary">
                  Edit Campaign
                </button>
                <button className="form-button form-button-primary">
                  Manage Members
                </button>
              </div>
            )}
          </div>

          {/* Campaign Scope */}
          <div className="campaign-scope-section">
            <div className="scope-header">
              <h2 className="section-title">Campaign Scope</h2>
              {campaign.hackerone_handle && (
                <div className="hackerone-sync-status">
                  <div className="sync-info">
                    <span className="badge bg-purple-100 text-purple-800">
                      🔗 HackerOne: {campaign.hackerone_handle}
                    </span>
                    <span className="sync-time">{formatSyncStatus()}</span>
                  </div>
                  {canManageCampaign() && (
                    <button
                      onClick={() => handleSync()}
                      disabled={syncing}
                      className={`sync-button ${syncing ? 'syncing' : ''}`}
                    >
                      {syncing ? (
                        <>
                          <span className="sync-spinner"></span>
                          Checking...
                        </>
                      ) : (
                        <>
                          <span>🔄</span>
                          Check HackerOne for Changes
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            {syncError && (
              <div className="sync-error" role="alert">
                {syncError}
              </div>
            )}
            {syncMessage && <p role="status">{syncMessage}</p>}
            <div className="campaign-scope-content">
              {campaign.scope}
            </div>
            {campaign.hackerone_handle && (
              <>
                <p className="form-help">Checking for changes is read-only. Saving a changed snapshot pauses the campaign and requires a new scope review before testing. This is not a runner-enforced scope control.</p>
                <p className="form-help">Manually review <a href={`https://hackerone.com/${encodeURIComponent(campaign.hackerone_handle)}/invite_only`} target="_blank" rel="noopener noreferrer">private-program rules</a>, <a href={`https://hackerone.com/${encodeURIComponent(campaign.hackerone_handle)}/updates`} target="_blank" rel="noopener noreferrer">updates and announcements</a>, and <a href="https://docs.hackerone.com/en/articles/8494488-core-ineligible-findings" target="_blank" rel="noopener noreferrer">core ineligible findings</a>. These separate pages are not verified by an API snapshot.</p>
                {campaign.hackerone_metadata?.scope_snapshot ? <HackerOneScopeSnapshot snapshot={campaign.hackerone_metadata.scope_snapshot} /> : <div className="import-info"><p>This legacy import has no verified full snapshot. Check HackerOne for changes to review and save one before testing.</p>{campaign.rules_of_engagement && <pre className="hackerone-policy-text">{campaign.rules_of_engagement}</pre>}</div>}
              </>
            )}
            {syncPreview && (
              <section className="hackerone-sync-preview" aria-label="Review HackerOne changes">
                <h3>{syncPreview.changed ? 'Policy or scope changed' : 'No policy or scope changes detected'}</h3>
                <p>{syncPreview.changed ? 'Review the latest complete snapshot below. Accepting it will pause this campaign; it will not start or resume testing.' : 'You can refresh the saved verification timestamp after reviewing this snapshot.'}</p>
                <HackerOneScopeSnapshot snapshot={syncPreview.scope_snapshot} />
                <label className="hackerone-review-check">
                  <input type="checkbox" checked={syncReviewed} disabled={syncing} onChange={event => setSyncReviewed(event.target.checked)} />
                  <span>I reviewed this snapshot and the separate program rules and updates. I understand that changes require a fresh assessment of testing authorization.</span>
                </label>
                <div className="form-actions">
                  <button type="button" className="form-button form-button-secondary" disabled={syncing} onClick={() => { setSyncPreview(null); setSyncReviewed(false); setSyncMessage(null) }}>Discard Preview</button>
                  <button type="button" className="form-button form-button-primary" disabled={syncing || !syncReviewed} onClick={() => handleSync(true)}>{syncing ? 'Verifying...' : syncPreview.changed ? 'Save Reviewed Snapshot and Pause' : 'Save Reviewed Snapshot'}</button>
                </div>
              </section>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="campaign-tabs">
            <button
              className={`campaign-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`campaign-tab ${activeTab === 'members' ? 'active' : ''}`}
              onClick={() => setActiveTab('members')}
            >
              Members ({campaign.campaign_members.length})
            </button>
            <button
              className={`campaign-tab ${activeTab === 'observations' ? 'active' : ''}`}
              onClick={() => setActiveTab('observations')}
            >
              Observations
            </button>
            <button
              className={`campaign-tab ${activeTab === 'findings' ? 'active' : ''}`}
              onClick={() => setActiveTab('findings')}
            >
              Findings
            </button>
            <button
              className={`campaign-tab ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveTab('tasks')}
            >
              Tasks
            </button>
            <button
              className={`campaign-tab ${activeTab === 'nodes' ? 'active' : ''}`}
              onClick={() => setActiveTab('nodes')}
            >
              Nodes
            </button>
            <button
              className={`campaign-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
          </div>

          {/* Tab Content */}
          <div className="campaign-content">
            {activeTab === 'overview' && (
              <div className="campaign-overview">
                <div className="overview-grid">
                  <div className="overview-card">
                    <h3 className="overview-card-title">Campaign Information</h3>
                    <div className="overview-card-content">
                      <div className="info-row">
                        <span className="info-label">Status:</span>
                        <span className={`badge ${getStatusBadgeColor(campaign.status)}`}>
                          {campaign.status}
                        </span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Privacy:</span>
                        <span className={`badge ${campaign.privacy === 'public' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'}`}>
                          {campaign.privacy}
                        </span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Created:</span>
                        <span>{formatDate(campaign.created_at)}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Last Updated:</span>
                        <span>{formatDate(campaign.updated_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="overview-card">
                    <h3 className="overview-card-title">Team Members</h3>
                    <div className="overview-card-content">
                      <div className="members-preview">
                        {campaign.campaign_members.slice(0, 3).map((member) => (
                          <div key={member.id} className="member-preview">
                            <div className="member-avatar">
                              {member.users.avatar_url ? (
                                <img 
                                  src={member.users.avatar_url} 
                                  alt={member.users.name}
                                  className="member-avatar-img"
                                />
                              ) : (
                                <div className="member-avatar-fallback">
                                  {member.users.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <div className="member-info">
                              <span className="member-name">{member.users.name}</span>
                              <span className={`member-role ${getRoleBadgeColor(member.role)}`}>
                                {member.role}
                              </span>
                            </div>
                          </div>
                        ))}
                        {campaign.campaign_members.length > 3 && (
                          <div className="member-more">
                            +{campaign.campaign_members.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="overview-card">
                    <h3 className="overview-card-title">Quick Actions</h3>
                    <div className="overview-card-content">
                      <div className="quick-actions">
                        {canCreateContent() && (
                          <>
                            <button className="quick-action-btn">
                              Create Task
                            </button>
                            <button className="quick-action-btn">
                              Add Observation
                            </button>
                          </>
                        )}
                        <button className="quick-action-btn">
                          View All Members
                        </button>
                        <button className="quick-action-btn">
                          Open Chat
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div className="campaign-members">
                <div className="members-header">
                  <h2 className="section-title">Team Members</h2>
                  {canManageCampaign() && (
                    <button className="form-button form-button-primary">
                      Add Member
                    </button>
                  )}
                </div>
                <div className="members-list">
                  {campaign.campaign_members.map((member) => (
                    <div key={member.id} className="member-card">
                      <div className="member-card-content">
                        <div className="member-avatar">
                          {member.users.avatar_url ? (
                            <img 
                              src={member.users.avatar_url} 
                              alt={member.users.name}
                              className="member-avatar-img"
                            />
                          ) : (
                            <div className="member-avatar-fallback">
                              {member.users.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="member-details">
                          <h3 className="member-name">{member.users.name}</h3>
                          <p className="member-email">{member.users.email}</p>
                          <div className="member-meta">
                            <span className={`member-role ${getRoleBadgeColor(member.role)}`}>
                              {member.role}
                            </span>
                            <span className="member-joined">
                              Joined {formatDate(member.joined_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {canManageCampaign() && member.role !== 'owner' && (
                        <div className="member-actions">
                          <button className="member-action-btn">
                            Change Role
                          </button>
                          <button className="member-action-btn member-action-btn-danger">
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'observations' && (
              <div className="campaign-observations">
                <div className="observations-header">
                  <h2 className="section-title">Observations</h2>
                  {canCreateContent() && (
                    <button className="form-button form-button-primary">
                      Add Observation
                    </button>
                  )}
                </div>
                <div className="empty-state">
                  <div className="empty-state-content">
                    <div className="empty-state-icon">🔍</div>
                    <h3 className="empty-state-title">No observations yet</h3>
                    <p className="empty-state-description">
                      Observations from scanning nodes will appear here.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'findings' && (
              <div className="campaign-findings">
                <div className="findings-header">
                  <h2 className="section-title">Findings</h2>
                  {canCreateContent() && (
                    <button className="form-button form-button-primary">
                      Create Finding
                    </button>
                  )}
                </div>
                <div className="empty-state">
                  <div className="empty-state-content">
                    <div className="empty-state-icon">🎯</div>
                    <h3 className="empty-state-title">No findings yet</h3>
                    <p className="empty-state-description">
                      Escalate observations to findings to track remediation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'tasks' && (
              <div className="campaign-tasks">
                <div className="tasks-header">
                  <h2 className="section-title">Tasks</h2>
                  {canCreateContent() && (
                    <button className="form-button form-button-primary">
                      Create Task
                    </button>
                  )}
                </div>
                <div className="empty-state">
                  <div className="empty-state-content">
                    <div className="empty-state-icon">📋</div>
                    <h3 className="empty-state-title">No tasks yet</h3>
                    <p className="empty-state-description">
                      Create scan jobs and other tasks for this campaign.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'nodes' && (
              <div className="campaign-nodes">
                <div className="nodes-header">
                  <h2 className="section-title">Scanning Nodes</h2>
                  <div className="nodes-status">
                    <span className="nodes-count">{nodes.length} node{nodes.length !== 1 ? 's' : ''}</span>
                    <span className="nodes-online">
                      {nodes.filter(node => node.status === 'online').length} online
                    </span>
                  </div>
                </div>
                
                {nodes.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-content">
                      <div className="empty-state-icon">🖥️</div>
                      <h3 className="empty-state-title">No scanning nodes</h3>
                      <p className="empty-state-description">
                        Connect Bastet scanning nodes to start collecting security data for this campaign.
                      </p>
                      <button className="cta-button">
                        Add Node
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="nodes-list">
                    {nodes.map((node) => (
                      <div key={node.id} className="node-card">
                        <div className="node-card-content">
                          <div className="node-card-header">
                            <div className="node-card-title-section">
                              <h3 className="node-card-title">{node.name}</h3>
                              <div className="node-card-badges">
                                <span className={`badge ${getNodeStatusBadgeColor(node.status)}`}>
                                  {node.status}
                                </span>
                                <span className={`badge ${getNodeTypeBadgeColor(node.node_type)}`}>
                                  {node.node_type}
                                </span>
                                {node.websocket_connection && (
                                  <span className="badge bg-green-100 text-green-800">
                                    connected
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {node.description && (
                            <p className="node-card-description">
                              {node.description}
                            </p>
                          )}
                          
                          <div className="node-card-meta">
                            <div className="node-meta-row">
                              <span className="node-meta-label">Last Seen:</span>
                              <span className="node-meta-value">
                                {node.last_seen ? formatDate(node.last_seen) : 'Never'}
                              </span>
                            </div>
                            <div className="node-meta-row">
                              <span className="node-meta-label">Created:</span>
                              <span className="node-meta-value">
                                {formatDate(node.created_at)}
                              </span>
                            </div>
                            {node.info && (
                              <div className="node-card-info">
                                <details className="node-info-details">
                                  <summary className="node-info-summary">Node Information</summary>
                                  <pre className="node-info-content">
                                    {JSON.stringify(node.info, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="node-card-actions">
                          <button className="node-action-btn">
                            View Details
                          </button>
                          <button className="node-action-btn">
                            Configure
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chat' && (
              <div className="campaign-chat">
                <div className="chat-header">
                  <h2 className="section-title">Campaign Chat</h2>
                </div>
                <div className="empty-state">
                  <div className="empty-state-content">
                    <div className="empty-state-icon">💬</div>
                    <h3 className="empty-state-title">No messages yet</h3>
                    <p className="empty-state-description">
                      Start a conversation with your team members.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
