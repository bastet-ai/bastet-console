import { useState, useEffect } from 'react'
import Head from 'next/head'
import Navbar from '../components/Navbar'
import HeroSection from '../sections/HeroSection'
import FeaturesSection from '../sections/FeaturesSection'
import WorkflowSection from '../sections/WorkflowSection'
import AdministrationSection from '../sections/AdministrationSection'
import Footer from '../components/Footer'

export default function Home() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for existing session
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('auth_token')
        if (token) {
          const response = await fetch('/api/auth/verify', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          
          if (response.ok) {
            const data = await response.json()
            setUser(data.user)
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error)
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [])

  const handleGoogleSignIn = async () => {
    try {
      // This will be implemented with Google OAuth
      console.log('Google sign in clicked')
    } catch (error) {
      console.error('Sign in failed:', error)
    }
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      localStorage.removeItem('auth_token')
      setUser(null)
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Bastet Console - Vulnerability Management Platform</title>
        <meta name="description" content="Comprehensive vulnerability management and security scanning platform" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar 
          user={user} 
          onSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
        />
        
        <main>
          <HeroSection user={user} onSignIn={handleGoogleSignIn} />
          <FeaturesSection />
          <WorkflowSection />
          <AdministrationSection />
        </main>
        
        <Footer />
      </div>
    </>
  )
}
