#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

console.log('🔒 Running Comprehensive Security Tests for Bastet Console\n')

// Test configuration
const config = {
  unitTests: {
    command: 'npm run test:unit:security',
    description: 'Unit Security Tests',
    timeout: 30000
  },
  e2eTests: {
    command: 'npx playwright test tests/e2e/security/',
    description: 'End-to-End Security Tests',
    timeout: 120000
  },
  integrationTests: {
    command: 'npm run test:integration:security',
    description: 'Integration Security Tests',
    timeout: 60000
  },
  securityScan: {
    command: 'npm audit --audit-level moderate',
    description: 'Dependency Security Scan',
    timeout: 30000
  }
}

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
}

// Test results storage
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  details: []
}

// Utility functions
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSection(title) {
  log(`\n${'='.repeat(60)}`, 'cyan')
  log(`  ${title}`, 'bright')
  log(`${'='.repeat(60)}`, 'cyan')
}

function logTestResult(testName, success, duration, details = '') {
  const status = success ? '✅ PASS' : '❌ FAIL'
  const color = success ? 'green' : 'red'
  
  log(`  ${status} ${testName} (${duration}ms)`, color)
  if (details) {
    log(`    ${details}`, 'yellow')
  }
  
  results.total++
  if (success) {
    results.passed++
  } else {
    results.failed++
  }
  
  results.details.push({
    name: testName,
    success,
    duration,
    details
  })
}

function runTest(testName, testConfig) {
  const startTime = Date.now()
  
  try {
    log(`\n🔍 Running ${testConfig.description}...`, 'blue')
    
    const output = execSync(testConfig.command, {
      encoding: 'utf8',
      timeout: testConfig.timeout,
      stdio: 'pipe'
    })
    
    const duration = Date.now() - startTime
    logTestResult(testName, true, duration)
    
    return { success: true, output, duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error.message || error.toString()
    
    logTestResult(testName, false, duration, errorMessage)
    
    return { success: false, error: errorMessage, duration }
  }
}

// Security test categories
const securityTests = [
  {
    name: 'Authentication Security',
    tests: [
      'JWT Token Validation',
      'Google OAuth Security',
      'Session Management',
      'Password Security',
      'Multi-Factor Authentication'
    ]
  },
  {
    name: 'Input Validation',
    tests: [
      'XSS Prevention',
      'SQL Injection Prevention',
      'NoSQL Injection Prevention',
      'Command Injection Prevention',
      'Path Traversal Prevention',
      'LDAP Injection Prevention',
      'XML/XXE Injection Prevention'
    ]
  },
  {
    name: 'API Security',
    tests: [
      'Authentication Requirements',
      'Authorization Controls',
      'Rate Limiting',
      'Input Validation',
      'Error Handling',
      'CORS Configuration',
      'CSRF Protection'
    ]
  },
  {
    name: 'Network Security',
    tests: [
      'HTTPS Enforcement',
      'TLS Configuration',
      'Certificate Validation',
      'DNS Security',
      'Firewall Rules',
      'Network Segmentation'
    ]
  },
  {
    name: 'Data Protection',
    tests: [
      'Data Encryption',
      'Data Masking',
      'Data Anonymization',
      'Data Retention',
      'Data Backup',
      'Data Recovery'
    ]
  },
  {
    name: 'Infrastructure Security',
    tests: [
      'Server Hardening',
      'Container Security',
      'Cloud Security',
      'Monitoring & Logging',
      'Incident Response',
      'Disaster Recovery'
    ]
  }
]

// Main execution
async function runSecurityTests() {
  log('🚀 Starting Security Test Suite', 'bright')
  log(`📅 Test Date: ${new Date().toISOString()}`, 'blue')
  log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`, 'blue')
  
  // Check if we're in the right directory
  if (!fs.existsSync('package.json')) {
    log('❌ Error: package.json not found. Please run from project root.', 'red')
    process.exit(1)
  }
  
  // Check if required dependencies are installed
  if (!fs.existsSync('node_modules')) {
    log('📦 Installing dependencies...', 'yellow')
    try {
      execSync('npm install', { stdio: 'inherit' })
    } catch (error) {
      log('❌ Failed to install dependencies', 'red')
      process.exit(1)
    }
  }
  
  // Run unit tests
  logSection('Unit Security Tests')
  const unitResult = runTest('Unit Tests', config.unitTests)
  
  // Run integration tests
  logSection('Integration Security Tests')
  const integrationResult = runTest('Integration Tests', config.integrationTests)
  
  // Run E2E tests
  logSection('End-to-End Security Tests')
  const e2eResult = runTest('E2E Tests', config.e2eTests)
  
  // Run security scan
  logSection('Dependency Security Scan')
  const securityScanResult = runTest('Security Scan', config.securityScan)
  
  // Generate report
  logSection('Security Test Report')
  generateReport()
  
  // Exit with appropriate code
  if (results.failed > 0) {
    log(`\n❌ Security tests failed: ${results.failed}/${results.total}`, 'red')
    process.exit(1)
  } else {
    log(`\n✅ All security tests passed: ${results.passed}/${results.total}`, 'green')
    process.exit(0)
  }
}

function generateReport() {
  log(`\n📊 Test Summary:`, 'bright')
  log(`  Total Tests: ${results.total}`, 'blue')
  log(`  Passed: ${results.passed}`, 'green')
  log(`  Failed: ${results.failed}`, 'red')
  log(`  Skipped: ${results.skipped}`, 'yellow')
  
  const passRate = ((results.passed / results.total) * 100).toFixed(2)
  log(`  Pass Rate: ${passRate}%`, passRate >= 90 ? 'green' : 'yellow')
  
  if (results.failed > 0) {
    log(`\n❌ Failed Tests:`, 'red')
    results.details
      .filter(test => !test.success)
      .forEach(test => {
        log(`  • ${test.name}: ${test.details}`, 'red')
      })
  }
  
  // Generate JSON report
  const reportData = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    summary: {
      total: results.total,
      passed: results.passed,
      failed: results.failed,
      skipped: results.skipped,
      passRate: parseFloat(passRate)
    },
    tests: results.details,
    securityCategories: securityTests
  }
  
  const reportPath = 'security-test-report.json'
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2))
  log(`\n📄 Detailed report saved to: ${reportPath}`, 'blue')
}

// Handle process termination
process.on('SIGINT', () => {
  log('\n\n⚠️  Security tests interrupted by user', 'yellow')
  process.exit(1)
})

process.on('SIGTERM', () => {
  log('\n\n⚠️  Security tests terminated', 'yellow')
  process.exit(1)
})

// Run the tests
runSecurityTests().catch(error => {
  log(`\n❌ Unexpected error: ${error.message}`, 'red')
  process.exit(1)
})
