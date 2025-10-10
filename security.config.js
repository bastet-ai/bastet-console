module.exports = {
  // Security test configuration
  security: {
    // Test timeouts (in milliseconds)
    timeouts: {
      unit: 30000,
      integration: 60000,
      e2e: 120000,
      security: 180000
    },
    
    // Test coverage thresholds
    coverage: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80
    },
    
    // Security test categories
    categories: {
      authentication: {
        enabled: true,
        tests: [
          'jwt-validation',
          'oauth-security',
          'session-management',
          'password-security',
          'mfa-security'
        ]
      },
      inputValidation: {
        enabled: true,
        tests: [
          'xss-prevention',
          'sql-injection-prevention',
          'nosql-injection-prevention',
          'command-injection-prevention',
          'path-traversal-prevention',
          'ldap-injection-prevention',
          'xxe-injection-prevention'
        ]
      },
      apiSecurity: {
        enabled: true,
        tests: [
          'authentication-requirements',
          'authorization-controls',
          'rate-limiting',
          'input-validation',
          'error-handling',
          'cors-configuration',
          'csrf-protection'
        ]
      },
      networkSecurity: {
        enabled: true,
        tests: [
          'https-enforcement',
          'tls-configuration',
          'certificate-validation',
          'dns-security',
          'firewall-rules',
          'network-segmentation'
        ]
      },
      dataProtection: {
        enabled: true,
        tests: [
          'data-encryption',
          'data-masking',
          'data-anonymization',
          'data-retention',
          'data-backup',
          'data-recovery'
        ]
      },
      infrastructureSecurity: {
        enabled: true,
        tests: [
          'server-hardening',
          'container-security',
          'cloud-security',
          'monitoring-logging',
          'incident-response',
          'disaster-recovery'
        ]
      }
    },
    
    // Security headers configuration
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
    },
    
    // CORS configuration
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
      maxAge: 86400
    },
    
    // Rate limiting configuration
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false
    },
    
    // JWT configuration
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: '7d',
      algorithm: 'HS256',
      issuer: 'bastet-console',
      audience: 'bastet-users'
    },
    
    // Password requirements
    password: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      maxLength: 128,
      preventCommonPasswords: true,
      preventUserInfo: true
    },
    
    // Session configuration
    session: {
      name: 'bastet-session',
      secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'strict'
      }
    },
    
    // Input validation rules
    validation: {
      maxStringLength: 1000,
      maxArrayLength: 100,
      maxObjectDepth: 10,
      allowedFileTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      sanitizeHtml: true,
      sanitizeSql: true,
      sanitizeCommands: true
    },
    
    // Security monitoring
    monitoring: {
      logSecurityEvents: true,
      logFailedAttempts: true,
      logSuspiciousActivity: true,
      alertThresholds: {
        failedLogins: 5,
        suspiciousRequests: 10,
        rateLimitHits: 20
      }
    },
    
    // Vulnerability scanning
    vulnerabilityScanning: {
      enabled: true,
      schedule: '0 2 * * *', // Daily at 2 AM
      tools: ['npm-audit', 'snyk', 'owasp-dependency-check'],
      severityThreshold: 'moderate',
      autoFix: false
    },
    
    // Security testing
    testing: {
      runOnCommit: true,
      runOnPR: true,
      runOnSchedule: true,
      includePenetrationTests: false,
      includeLoadTests: true,
      includeChaosTests: false
    }
  },
  
  // Environment-specific configurations
  environments: {
    development: {
      security: {
        logLevel: 'debug',
        strictMode: false,
        allowInsecureConnections: true
      }
    },
    staging: {
      security: {
        logLevel: 'info',
        strictMode: true,
        allowInsecureConnections: false
      }
    },
    production: {
      security: {
        logLevel: 'warn',
        strictMode: true,
        allowInsecureConnections: false,
        enableHSTS: true,
        enableCSP: true
      }
    }
  }
}
