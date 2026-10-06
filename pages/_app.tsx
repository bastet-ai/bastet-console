import { AppProps } from 'next/app'
import Head from 'next/head'
import Script from 'next/script'
import { useEffect, useState } from 'react'
import { isLocalDebug } from '../src/lib/authClient'
import '../src/styles/index.css'

export default function App({ Component, pageProps }: AppProps) {
  const [debug, setDebug] = useState(false)
  useEffect(() => { void isLocalDebug().then(setDebug) }, [])
  return (
    <>
      <Head>
        <title>Bastet Console</title>
        <meta name="description" content="Operational command for your Bastet nodes" />
        <link rel="icon" href="/favicon.svg" />
      </Head>
      
      {/* Google Identity Services - Custom OAuth (NOT Supabase Auth) */}
      <Script 
        src="https://apis.google.com/js/api.js" 
        strategy="afterInteractive"
      />
      <Script 
        src="https://accounts.google.com/gsi/client" 
        strategy="afterInteractive"
      />
      
      {debug && <div role="status" style={{ background: '#92400e', color: 'white', padding: '12px', textAlign: 'center' }}>
        Local debug admin · Live Majin data · Changes also appear at console.bastet.ai
      </div>}
      <Component {...pageProps} />
    </>
  )
}
