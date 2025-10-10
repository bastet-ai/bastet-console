import { useState, useEffect } from 'react'

interface ConfigError {
  type: 'missing' | 'invalid_length' | 'invalid_format'
  variable: string
  message: string
  expected?: string
  actual?: string
}

export function ConfigValidationBanner() {
  const [errors, setErrors] = useState<ConfigError[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkConfiguration = async () => {
      try {
        const response = await fetch('/api/debug/env')
        const data = await response.json()
        
        const configErrors: ConfigError[] = []

        // Check Google Client ID
        if (data.client_id_length !== 72) {
          configErrors.push({
            type: 'invalid_length',
            variable: 'GOOGLE_CLIENT_ID',
            message: 'Google Client ID has incorrect length',
            expected: '72 characters',
            actual: `${data.client_id_length} characters`
          })
        }

        // Check Google Client Secret
        if (data.client_secret_length !== 36) {
          configErrors.push({
            type: 'invalid_length',
            variable: 'GOOGLE_CLIENT_SECRET',
            message: 'Google Client Secret has incorrect length',
            expected: '36 characters',
            actual: `${data.client_secret_length} characters`
          })
        }

        // Check if client IDs match
        if (!data.client_ids_match) {
          configErrors.push({
            type: 'invalid_format',
            variable: 'CLIENT_ID_MISMATCH',
            message: 'Server and client Google Client IDs do not match',
            expected: 'Same value for both',
            actual: 'Different values'
          })
        }

        // Check for missing environment variables
        Object.entries(data.environment_check).forEach(([key, value]) => {
          if (value === 'missing') {
            configErrors.push({
              type: 'missing',
              variable: key,
              message: `${key} environment variable is missing`,
              expected: 'Present',
              actual: 'Missing'
            })
          }
        })

        setErrors(configErrors)
      } catch (error) {
        console.error('Failed to check configuration:', error)
        setErrors([{
          type: 'missing',
          variable: 'CONFIG_CHECK',
          message: 'Failed to check configuration status',
          expected: 'Working',
          actual: 'Error'
        }])
      } finally {
        setLoading(false)
      }
    }

    checkConfiguration()
  }, [])

  if (loading) {
    return null
  }

  if (errors.length === 0) {
    return null
  }

  return (
    <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">
            Configuration Issues Detected
          </h3>
          <div className="mt-2 text-sm text-red-700">
            <ul className="list-disc list-inside space-y-1">
              {errors.map((error, index) => (
                <li key={index}>
                  <strong>{error.variable}:</strong> {error.message}
                  {error.expected && (
                    <span className="block text-xs mt-1">
                      Expected: {error.expected} | Actual: {error.actual}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3">
            <div className="text-sm text-red-700">
              <p className="font-medium">To fix these issues:</p>
              <ol className="list-decimal list-inside mt-1 space-y-1">
                <li>Go to Google Cloud Console → APIs & Services → Credentials</li>
                <li>Copy the correct Client ID and Client Secret</li>
                <li>Update them in Vercel using: <code className="bg-red-100 px-1 rounded">vercel env add</code></li>
                <li>Redeploy the application</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
