import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import CampaignForm from '../src/components/CampaignForm'
import HackerOneScopeSnapshot from '../src/components/HackerOneScopeSnapshot'

const snapshot = {
  sha256: 'a'.repeat(64),
  fetched_at: '2026-10-06T12:00:00.000Z',
  policy: 'Only own accounts. <script>no execution</script>',
  assets: [
    { asset_identifier: '*.example.test', eligible_for_submission: true, eligible_for_bounty: false, instruction: `Complete asset note ${'x'.repeat(200)} END OF NOTE` },
    { asset_identifier: 'excluded.example.test', eligible_for_submission: false, eligible_for_bounty: false, instruction: 'Never test this asset.' }
  ],
  exclusions: [{ id: 'synthetic-exclusion', category: 'availability', details: 'No disruptive testing.' }]
}

test('snapshot renders complete policy, full notes, eligibility and exclusions as escaped text', () => {
  const html = renderToStaticMarkup(React.createElement(HackerOneScopeSnapshot, { snapshot }))
  assert.match(html, /&lt;script&gt;no execution&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /END OF NOTE/)
  assert.match(html, /eligible for bounty/)
  assert.match(html, /Out-of-scope or eligibility-unconfirmed assets \(1\)/)
  assert.match(html, /No disruptive testing\./)
  assert.match(html, /2026-10-06T12:00:00.000Z/)
  assert.match(html, new RegExp(snapshot.sha256))
})

test('archived assets never appear among submission-eligible assets even with a true eligibility flag', () => {
  const html = renderToStaticMarkup(React.createElement(HackerOneScopeSnapshot, {
    snapshot: { ...snapshot, assets: [
      ...snapshot.assets,
      { asset_identifier: 'retired.example.test', eligible_for_submission: true, eligible_for_bounty: true, archived_at: '2026-10-01T00:00:00.000Z' }
    ] }
  }))
  assert.match(html, /Submission-eligible assets and full notes \(1\)/)
  assert.match(html, /Out-of-scope or eligibility-unconfirmed assets \(1\)/)
  assert.match(html, /Archived assets, not eligible for testing \(1\)/)
  const eligibleSection = html.slice(html.indexOf('Submission-eligible assets'), html.indexOf('Out-of-scope or eligibility-unconfirmed assets'))
  assert.doesNotMatch(eligibleSection, /retired\.example\.test/)
  assert.match(html.slice(html.indexOf('Archived assets, not eligible for testing')), /retired\.example\.test/)
})

async function mountForm(fetchMock: typeof fetch, onSubmit = async (_data: unknown) => {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1:5173' })
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: fetchMock })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.localStorage.setItem('auth_token', 'synthetic-local-session')
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root')!
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(CampaignForm, { onSubmit, onCancel() {} })))
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(label))
    assert.ok(button, `Missing button: ${label}`)
    await act(async () => button.click())
  }
  return { container, click, dom, async cleanup() {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  } }
}

test('private import sends session auth, locks privacy, requires review and submits only a small digest reference', async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  let submitted: any
  const view = await mountForm(async (url, init) => {
    requests.push({ url: String(url), init })
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-local-session')
    return new Response(JSON.stringify(init?.method === 'POST' ? {
      success: true,
      campaign: { name: 'Synthetic program', description: 'Synthetic description', scope: '*.example.test', privacy: 'private', status: 'paused', rulesOfEngagement: snapshot.policy, hackerone_handle: 'synthetic-program', hackerone_metadata: { scope_snapshot: snapshot } }
    } : { success: true, configured: true, authorized: true }), { headers: { 'Content-Type': 'application/json' } })
  }, async data => { submitted = data })
  try {
    await view.click('Import from HackerOne')
    const input = view.container.querySelector<HTMLInputElement>('#hackerone-handle')!
    // React's controlled input listens to the native setter and input event.
    const setter = Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'https://hackerone.com/synthetic-program')
      input.dispatchEvent(new view.dom.window.Event('input', { bubbles: true }))
    })
    const importButton = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Import')!
    assert.equal(importButton.disabled, false)
    await act(async () => importButton.click())
    const submit = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!
    assert.ok(submit.disabled)
    assert.ok(view.container.querySelector<HTMLInputElement>('input[value="public"]')!.disabled)
    assert.match(view.container.textContent!, /END OF NOTE/)
    await act(async () => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    assert.equal(submit.disabled, false)
    await act(async () => view.container.querySelector('form')!.dispatchEvent(new view.dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(submitted.privacy, 'private')
    assert.equal(submitted.status, 'paused')
    assert.equal(submitted.hackerone_metadata.scope_snapshot.sha256, snapshot.sha256)
    assert.equal(submitted.scope, undefined)
    assert.equal(submitted.rulesOfEngagement, undefined)
    assert.equal(submitted.hackerone_metadata.scope_snapshot.policy, undefined)
    assert.equal(JSON.stringify(submitted).includes('END OF NOTE'), false)
    assert.equal(JSON.parse(String(requests[1].init?.body)).programHandle, 'https://hackerone.com/synthetic-program')
  } finally { await view.cleanup() }
})

for (const status of [{ configured: false, authorized: true }, { configured: true, authorized: false }]) {
  test(`import is unavailable when configured=${status.configured}, authorized=${status.authorized}`, async () => {
    const view = await mountForm(async () => new Response(JSON.stringify({ success: true, ...status })))
    try {
      await view.click('Import from HackerOne')
      assert.match(view.container.textContent!, status.configured ? /not authorized/ : /not configured/)
      const button = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Import')!
      assert.ok(button.disabled)
      assert.equal(view.container.querySelector('input[type="password"]'), null)
    } finally { await view.cleanup() }
  })
}
