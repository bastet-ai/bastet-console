# Agent Instructions

## Current architecture (October 2026)

The historical sections below predate two migrations. Follow `README.md` and
`docs/majin-backend.md` for the current architecture: vinext/React 19 on Cloudflare,
Node 24 API plus SQLite on Majin, and loopback-only local debug login. Never widen
debug access or add browser-visible service secrets. Do not modify Buzz or the
scan-data database as part of console work. Preserve D1 and verified exports for
recovery; never switch back to stale D1 after Majin has accepted new writes.
Stage only task-related changes, not unrelated working-tree edits. Record release
and live verification evidence in `NOTES.md`; validate before commit/push/deploy.

## Important Reminder for AI Agents

**ALWAYS commit and push your changes after every update!**

When making any changes to the codebase:
1. Make your changes
2. Test that everything works
3. Run: `git add .`
4. Run: `git commit -m "Descriptive commit message"`
5. Run: `git push`

This ensures that:
- All changes are tracked in version control
- Other agents and team members can see your work
- The deployment picks up the latest changes
- There's a clear history of what was changed and why

## Current Project Status

### Architecture Overview
This project is a **Next.js full-stack application** for Bastet Console - a vulnerability management platform that orchestrates distributed security scanning nodes.

**Tech Stack:**
- **Frontend**: Next.js 14+ with React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes (server-side)
- **Database**: Supabase PostgreSQL (database-only, no auth)
- **Authentication**: Custom Google OAuth 2.0 implementation
- **Deployment**: Vercel
- **Testing**: Jest (unit), Playwright (E2E), comprehensive security tests
- **Security**: Socket.dev (supply chain), npm audit, custom security tests

### Project Structure
```
bastet-console/
├── pages/                    # Next.js pages and API routes
│   ├── api/                 # Backend API endpoints
│   │   ├── auth/           # Authentication endpoints
│   │   ├── nodes/          # Node management endpoints
│   │   └── ws/             # WebSocket endpoints
│   ├── _app.tsx            # App wrapper with Google OAuth scripts
│   └── index.tsx           # Main homepage
├── src/                     # Source code
│   ├── components/         # React components
│   ├── sections/          # Page sections
│   ├── lib/               # Utilities and client code
│   └── styles/            # CSS styles
├── tests/                  # Comprehensive test suite
│   ├── unit/security/     # Unit security tests
│   ├── e2e/security/      # End-to-end security tests
│   └── integration/       # Integration tests
├── scripts/               # Build and utility scripts
└── .github/workflows/     # CI/CD pipelines
```

### Current State (December 2024)

#### ✅ Completed
- **Next.js Migration**: Converted from Vite to Next.js with full-stack capabilities
- **Database Schema**: Complete Supabase schema with users, nodes, and scan_results tables
- **API Routes**: Authentication, node management, and WebSocket endpoints
- **Security Testing**: Comprehensive test suite with 90%+ coverage
- **Documentation**: SECURITY.md, TODO.md, and comprehensive agent instructions
- **CI/CD**: GitHub Actions workflows for automated testing and deployment

#### ❌ Critical Issues (BLOCKING)
1. **Build Failures**: Vercel deployment failing due to TypeScript/import errors
2. **Google OAuth**: Implementation incomplete, still redirecting to Supabase auth
3. **Environment Variables**: Using placeholder values, need real Google OAuth credentials
4. **Database Migration**: Schema not yet deployed to Supabase

#### 🔄 In Progress
- **Authentication Flow**: Custom Google OAuth implementation
- **Environment Setup**: Real credentials configuration
- **Build Process**: Fixing compilation errors

### Authentication Architecture

**Current Implementation:**
- **Custom Google OAuth 2.0** (NOT Supabase Auth)
- **JWT-based sessions** with 7-day expiration
- **Server-side token verification** via API routes
- **Local storage** for client-side token management

**Key Files:**
- `pages/api/auth/google.ts` - Google OAuth handler
- `pages/api/auth/verify.ts` - Session verification
- `pages/api/auth/logout.ts` - Logout handler
- `src/lib/supabaseClient.ts` - Client-side auth functions

**Environment Variables Needed:**
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` - Frontend Google OAuth
- `GOOGLE_CLIENT_ID` - Backend Google OAuth
- `JWT_SECRET` - JWT signing secret
- `SUPABASE_URL` - Database URL
- `SUPABASE_ANON_KEY` - Database anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Database service role key

### Database Schema

**Tables:**
- `users` - Google OAuth user data (id, email, name, google_id, avatar_url, etc.)
- `bastet_nodes` - Scanning nodes (id, user_id, name, type, status, info, etc.)
- `scan_results` - Vulnerability scan results (id, node_id, scan_id, results, etc.)

**Key Features:**
- **Row Level Security (RLS)** enabled on all tables
- **Automatic timestamps** with triggers
- **Foreign key relationships** with cascade deletes
- **JSONB fields** for flexible data storage

### Security Implementation

**Comprehensive Security Testing:**
- **Unit Tests**: Authentication, API security, input validation, CORS/CSRF
- **E2E Tests**: Full user flows, security scenarios
- **Penetration Testing**: XSS, SQL injection, command injection prevention
- **Dependency Scanning**: Automated vulnerability detection

**Security Features:**
- **Input Sanitization**: XSS, SQL injection, command injection prevention
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Security Headers**: CSP, HSTS, X-Frame-Options, etc.
- **JWT Security**: HMAC-SHA256 with secure secrets
- **CORS Protection**: Strict origin validation

### API Endpoints

**Authentication:**
- `POST /api/auth/google` - Google OAuth login
- `GET /api/auth/verify` - Verify JWT session
- `POST /api/auth/logout` - Logout user

**Node Management:**
- `GET /api/nodes` - List user's nodes
- `POST /api/nodes` - Create new node
- `GET /api/nodes/[id]` - Get specific node
- `PUT /api/nodes/[id]` - Update node
- `DELETE /api/nodes/[id]` - Delete node

**WebSocket:**
- `WS /api/ws/nodes` - Real-time node communication

### Testing Strategy

**Test Commands:**
```bash
npm run test:unit:security      # Unit security tests
npm run test:e2e:security       # End-to-end security tests
npm run test:security           # Complete security test suite
npm run security:audit          # Dependency vulnerability scan
```

**Coverage Targets:**
- Authentication: 95%
- Authorization: 90%
- Input Validation: 98%
- API Security: 92%
- Data Protection: 88%

### Deployment Process

**Vercel Configuration:**
- **Automatic deployments** from main branch
- **Environment variables** configured in Vercel dashboard
- **Build command**: `npm run build`
- **Output directory**: `.next`

**Deployment Commands:**
```bash
vercel --prod                    # Deploy to production
vercel env add <name> <target>   # Add environment variable
vercel logs <deployment>         # View deployment logs
```

### Common Issues & Solutions

#### Build Failures
- **Issue**: TypeScript compilation errors
- **Solution**: Check import paths, fix type definitions
- **Files**: `tsconfig.json`, component imports

#### OAuth Redirects
- **Issue**: Still redirecting to Supabase auth
- **Solution**: Use custom Google OAuth implementation
- **Files**: `src/lib/supabaseClient.ts`, `pages/index.tsx`

#### Environment Variables
- **Issue**: Using placeholder values
- **Solution**: Set real values in Vercel dashboard
- **Required**: Google OAuth credentials, JWT secret, Supabase keys

#### Database Connection
- **Issue**: Schema not deployed
- **Solution**: Run `supabase-schema.sql` in Supabase dashboard
- **File**: `supabase-schema.sql`

#### Vercel Deployment Issues
- **Issue**: "No Output Directory named 'dist' found"
- **Solution**: Add `vercel.json` with `{"framework": "nextjs"}` to override Vite settings
- **Issue**: Build errors in deployment but works locally
- **Solution**: Check environment variables are set in Vercel dashboard
- **Issue**: Routes manifest errors
- **Solution**: Simplify `next.config.js`, remove complex outputFileTracingRoot settings

### Development Workflow

1. **Make Changes**: Edit code in appropriate directories
2. **Test Locally**: Run `npm run dev` to test changes
3. **Run Tests**: Execute security test suite
4. **Commit Changes**: Always commit with descriptive messages
5. **Push to GitHub**: Triggers automatic deployment
6. **🚨 CRITICAL: Check Vercel Deployment Logs**: ALWAYS verify deployment success
   ```bash
   vercel ls                    # Check deployment status
   vercel logs <deployment-id>  # Check logs for errors
   ```
   - Look for "● Ready" status (not "● Error")
   - Check build logs for compilation errors
   - Verify environment variables are set correctly
   - Test the deployed URL to ensure it's working

### Key Learnings from Development

#### Architecture Decisions
- **Chose Next.js over Vite** for full-stack capabilities
- **Custom OAuth over Supabase Auth** for better control
- **JWT over sessions** for stateless authentication
- **Comprehensive testing** from day one

#### Security First Approach
- **Input validation** at every entry point
- **Rate limiting** to prevent abuse
- **Security headers** for protection
- **Automated testing** for continuous security

#### Database Design
- **User-centric design** with proper relationships
- **Flexible JSONB fields** for extensibility
- **Row Level Security** for data isolation
- **Audit trails** with timestamps

### Future Development Priorities

#### Immediate (Next 2 Weeks)
1. **Fix build errors** to enable deployment
2. **Complete Google OAuth** implementation
3. **Deploy database schema** to Supabase
4. **Set up real environment variables**

#### Short Term (Next Month)
1. **Node management UI** and functionality
2. **WebSocket implementation** for real-time features
3. **Dashboard and monitoring** interfaces
4. **Complete security testing** suite

#### Long Term (Next 3 Months)
1. **Multi-tenant support** for enterprise users
2. **Advanced analytics** and reporting
3. **Integration ecosystem** with third-party tools
4. **Mobile applications** for on-the-go management

### Important Notes for Future Agents

1. **Always check TODO.md** for current priorities
2. **Security is paramount** - run tests before any deployment
3. **Environment variables** are critical - verify they're set correctly
4. **Database schema** must be deployed before testing auth
5. **Google OAuth** requires real credentials from Google Console
6. **Build process** must work before deployment
7. **Test coverage** should remain above 90%
8. **Documentation** should be updated with any changes

### Supply Chain Security with Socket.dev

**Socket.dev Integration:**
- **Configuration**: `socket.yml` - Security policies and monitoring rules
- **GitHub Actions**: `.github/workflows/socket-security.yml` - Automated scanning
- **CLI Integration**: `npm run security:socket` - Local security scanning
- **Documentation**: `SUPPLY_CHAIN_SECURITY.md` - Comprehensive security guide

**Security Features:**
- **Malware Detection**: Identifies malicious packages
- **Typo Squatting**: Detects deceptive package names
- **Install Scripts**: Flags packages that execute code during installation
- **Native Code**: Identifies packages with compiled binaries
- **Telemetry**: Detects packages that collect user data
- **Vulnerability Scanning**: Checks for known security vulnerabilities

**Setup Instructions:**
1. **Install Socket.dev GitHub App**: https://github.com/apps/socket-security
2. **Configure Repository**: Select `bastet-ai/bastet-console` for monitoring
3. **Set API Key**: Add `SOCKET_API_KEY` to GitHub repository secrets
4. **Test Integration**: Run `npm run security:socket` locally

**Monitoring:**
- **Pull Request Comments**: Security alerts on dependency changes
- **GitHub Issues**: Critical security problems automatically flagged
- **Daily Scans**: Scheduled security checks via GitHub Actions
- **Artifact Storage**: Security scan results stored for 30 days

### Campaign Management System Implementation

**Campaign Management Features Completed (December 2024):**

#### ✅ Database Schema & API
- **Complete Database Schema**: Campaigns, members, observations, findings, tasks, and messages
- **HackerOne Integration**: Columns for handle, last_synced, and metadata tracking
- **Row Level Security (RLS)**: Proper access control for all tables
- **API Endpoints**: Full CRUD operations for campaigns and member management
- **Sync API**: Re-sync endpoint for updating campaigns from HackerOne
- **User Roles**: Owner, Manager, Collaborator, Watcher with proper permissions

#### ✅ User Interface Components
- **Campaign Dashboard** (`/campaigns`): Grid layout with campaign cards, creation modal
- **Campaign Detail Page** (`/campaigns/[id]`): Comprehensive campaign management interface
- **Campaign Form**: Modal-based creation with validation and privacy settings
- **Responsive Design**: Mobile-first approach with desktop optimization

#### ✅ Key Features Implemented
- **Campaign Creation**: Name, description, scope, privacy settings (private/public)
- **HackerOne Import**: Import campaigns from HackerOne programs with one click
- **HackerOne Sync**: Re-sync campaigns to update scope and policy from HackerOne
- **Sync Tracking**: Display last sync timestamp and sync status indicators
- **Member Management**: View team members with roles and avatars
- **Role-based Access**: Different permissions for owners, managers, collaborators, watchers
- **Tabbed Interface**: Overview, Members, Observations, Findings, Tasks, Nodes, Chat
- **Status Management**: Campaign status badges (active, paused, completed, archived)
- **Privacy Controls**: Public/private campaign visibility

#### ✅ Technical Implementation
- **TypeScript**: Full type safety with interfaces for all data structures
- **Authentication Integration**: JWT-based access control
- **Error Handling**: Comprehensive error states and user feedback
- **Loading States**: Proper loading indicators and skeleton screens
- **Navigation**: Breadcrumb navigation and proper routing

#### ✅ UI/UX Excellence
- **Professional Design**: Card-based layouts with hover effects
- **Color-coded Badges**: Role and status indicators with semantic colors
- **Empty States**: Helpful messages for users with no data
- **Modal Overlays**: Clean campaign creation experience
- **Responsive Grid**: Adaptive layouts for different screen sizes

### Campaign Management Architecture

**Database Tables:**
- `campaigns` - Core campaign data (name, description, scope, privacy, status)
- `campaign_members` - User roles and permissions (owner, manager, collaborator, watcher)
- `observations` - Raw data from scanning nodes
- `findings` - Escalated observations requiring action
- `tasks` - Scan jobs and remediation tasks
- `campaign_messages` - Real-time chat for collaboration

**API Endpoints:**
- `GET/POST /api/campaigns` - List and create campaigns
- `GET/PUT/DELETE /api/campaigns/[id]` - Individual campaign operations
- `GET/POST/PUT/DELETE /api/campaigns/[id]/members` - Member management

**User Roles & Permissions:**
- **Owner**: Full control, can manage members, delete campaign
- **Manager**: Can manage members, create content, manage tasks
- **Collaborator**: Can create observations, findings, tasks
- **Watcher**: Read-only access to campaign data

### HackerOne Integration

**Import Functionality:**
- **Mode Selector**: Two-button interface for Manual Entry vs HackerOne Import
- **Program Handle Input**: Enter HackerOne program handle (e.g., "github", "security", "shopify")
- **Auto-fill Campaign Data**: Automatically populates name, description, scope from program
- **Tested Programs**: Successfully tested with security, github, shopify, coinbase programs

**Sync Tracking:**
- **Database Columns**: `hackerone_handle`, `hackerone_last_synced`, `hackerone_metadata`
- **Initial Sync**: Timestamp recorded when campaign is created from HackerOne import
- **Metadata Storage**: Program URL, state, bounty status, submission state, asset count

**Re-sync Functionality:**
- **Permission-based**: Only managers and owners can trigger re-sync
- **API Endpoint**: `/api/campaigns/sync` - Updates campaign from latest HackerOne data
- **Scope Updates**: Fetches latest in-scope assets and updates campaign scope
- **Policy Updates**: Updates rules of engagement from HackerOne program policy
- **Timestamp Updates**: Records sync timestamp for tracking freshness

**UI/UX:**
- **Sync Status Badge**: Purple badge showing "🔗 HackerOne: [handle]"
- **Relative Timestamps**: "Synced X hours ago" / "Synced X days ago"
- **Re-sync Button**: Purple gradient button with loading state
- **Sync Spinner**: Animated spinner during sync operation
- **Error Handling**: User-friendly error messages for failed syncs
- **Success Notification**: Alert confirmation after successful sync

**Technical Implementation:**
- **GraphQL API**: Direct queries to HackerOne public GraphQL API
- **JWT Authentication**: Secure API endpoint with user verification
- **Permission Checks**: Role-based access control at API level
- **Atomic Updates**: Database transactions for consistent state
- **Type Safety**: Full TypeScript interfaces throughout

**Next Phase Ready:**
- Observations management (scan results from nodes)
- Findings system (escalation workflow)
- Task management (scan jobs and remediation)
- Real-time chat system
- Advanced member management (invitations, role changes)

### Development Patterns Learned

#### ✅ Component Architecture
- **Page Components**: Full-page layouts with authentication checks
- **Reusable Components**: CampaignForm for creation, Navbar for navigation
- **TypeScript Interfaces**: Comprehensive type definitions for data structures
- **Error Boundaries**: Proper error handling and user feedback

#### ✅ State Management
- **React Hooks**: useState, useEffect for local state management
- **Authentication State**: JWT token management and session verification
- **Loading States**: Proper loading indicators and error states
- **Form State**: Controlled components with validation

#### ✅ CSS Architecture
- **Component-scoped Styles**: Organized CSS with clear naming conventions
- **Responsive Design**: Mobile-first approach with desktop optimization
- **CSS Variables**: Consistent color scheme and theming
- **Grid Layouts**: Flexible, responsive grid systems

#### ✅ API Integration
- **RESTful Design**: Standard HTTP methods and status codes
- **Authentication Headers**: JWT token in Authorization header
- **Error Handling**: Consistent error response format
- **Type Safety**: TypeScript interfaces for API responses

### Deployment & Testing

#### ✅ Build Process
- **Next.js Build**: Successful compilation with TypeScript
- **Route Generation**: Static and dynamic routes properly configured
- **Asset Optimization**: Proper bundling and code splitting
- **Environment Variables**: Secure configuration management

#### ✅ Vercel Deployment
- **Production Builds**: Successful deployment to Vercel
- **Environment Configuration**: Proper environment variable setup
- **Domain Configuration**: Custom domain (console.bastet.ai) working
- **Build Logs**: Monitoring deployment success and errors

### Security Considerations

#### ✅ Authentication & Authorization
- **JWT Tokens**: Secure session management
- **Role-based Access**: Proper permission checks
- **API Security**: Authentication required for all campaign endpoints
- **Input Validation**: Server-side validation for all user inputs

#### ✅ Data Protection
- **Row Level Security**: Database-level access control
- **Privacy Settings**: Campaign visibility controls
- **User Data**: Secure handling of user information and avatars
- **API Security**: Proper error handling without data leakage

### Performance Optimizations

#### ✅ Frontend Performance
- **Code Splitting**: Next.js automatic code splitting
- **Image Optimization**: Proper avatar handling with fallbacks
- **Lazy Loading**: Modal components loaded on demand
- **Responsive Images**: Proper image sizing and optimization

#### ✅ Backend Performance
- **Database Indexes**: Proper indexing for campaign queries
- **API Efficiency**: Optimized database queries with joins
- **Caching Strategy**: Proper HTTP caching headers
- **Error Handling**: Efficient error responses

### Contact & Resources

- **Repository**: https://github.com/bastet-ai/bastet-console
- **Deployment**: https://console.bastet.ai
- **Documentation**: See README.md, SECURITY.md, SUPPLY_CHAIN_SECURITY.md, TODO.md
- **Issues**: Use GitHub Issues for bug reports
- **Security**: Use GitHub Security Advisories for vulnerabilities
- **Socket.dev**: https://socket.dev/ - Supply chain security monitoring

---

**Last Updated**: December 2024  
**Next Review**: After each major development session  
**Maintainer**: AI Agents and Development Team
