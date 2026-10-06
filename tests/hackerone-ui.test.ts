import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import CampaignForm from '../src/components/CampaignForm'
import HackerOneScopeSnapshot from '../src/components/HackerOneScopeSnapshot'
import ProgramSetupPlan from '../src/components/ProgramSetupPlan'
import { buildProgramSetupPlan } from '../src/lib/programSetupPlan'

const snapshot = {
  sha256: 'a'.repeat(64),
  fetched_at: '2026-10-06T12:00:00.000Z',
  policy: 'Only own accounts. <script>no execution</script>',
  assets: [
    { id: 'web-1', asset_identifier: '*.example.test', asset_type: 'WILDCARD', eligible_for_submission: true, eligible_for_bounty: false, instruction: `Complete asset note ${'x'.repeat(200)} END OF NOTE` },
    { asset_identifier: 'excluded.example.test', eligible_for_submission: false, eligible_for_bounty: false, instruction: 'Never test this asset.' }
  ],
  exclusions: [{ id: 'synthetic-exclusion', category: 'availability', details: 'No disruptive testing.' }]
}

const androidSnapshot = { ...snapshot, assets: [...snapshot.assets, {
  id: 'android-1', asset_identifier: 'com.example.synthetic', asset_type: 'GOOGLE_PLAY_APP_ID', eligible_for_submission: true, eligible_for_bounty: true, archived_at: null
}] }

function importedCampaign(scopeSnapshot = snapshot) {
  return { name: 'Synthetic program', description: 'Synthetic description', scope: '*.example.test', privacy: 'private', status: 'paused', rulesOfEngagement: scopeSnapshot.policy, hackerone_handle: 'synthetic-program', hackerone_metadata: { scope_snapshot: scopeSnapshot } }
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

async function mountForm(fetchMock: typeof fetch, onSubmit = async (_data: unknown) => {}, options: { onCancel?: () => void; component?: React.ReactElement } = {}) {
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
  await act(async () => root.render(options.component ?? React.createElement(CampaignForm, { onSubmit, onCancel: options.onCancel ?? (() => {}) })))
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(label))
    assert.ok(button, `Missing button: ${label}`)
    await act(async () => button.click())
  }
  const input = async (selector: string, value: string) => {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
    assert.ok(element, `Missing field: ${selector}`)
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  return { container, click, input, dom, async cleanup() {
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
      campaign: importedCampaign()
    } : { success: true, configured: true, authorized: true }), { headers: { 'Content-Type': 'application/json' } })
  }, async data => { submitted = data })
  try {
    await view.click('Import from HackerOne')
    await view.input('#hackerone-handle', 'Synthetic program')
    const importButton = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Find Program')!
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
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { programQuery: 'Synthetic program' })
  } finally { await view.cleanup() }
})

for (const status of [{ configured: false, authorized: true }, { configured: true, authorized: false }]) {
  test(`import is unavailable when configured=${status.configured}, authorized=${status.authorized}`, async () => {
    let cancelled = false
    const view = await mountForm(async () => new Response(JSON.stringify({ success: true, ...status })), undefined, { onCancel: () => { cancelled = true } })
    try {
      await view.click('Import from HackerOne')
      assert.match(view.container.textContent!, status.configured ? /not authorized/ : /not configured/)
      const button = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent === 'Find Program')!
      assert.ok(button.disabled)
      assert.equal(view.container.querySelector('input[type="password"]'), null)
      await view.click('Cancel')
      assert.equal(cancelled, true)
    } finally { await view.cleanup() }
  })
}

test('ambiguous names require explicit candidate selection and stale matches clear when input changes', async () => {
  const requests: Record<string, string>[] = []
  const view = await mountForm(async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-local-session')
    if (init?.method !== 'POST') return new Response(JSON.stringify({ success: true, configured: true, authorized: true }))
    const body = JSON.parse(String(init.body))
    requests.push(body)
    return new Response(JSON.stringify(body.programHandle ? { success: true, campaign: importedCampaign() } : {
      success: true,
      candidates: [
        { handle: 'synthetic-program', name: 'Synthetic mobile <img src=x>', url: 'javascript:alert(1)' },
        { handle: 'synthetic-other', name: 'Synthetic other', url: 'https://hackerone.com/synthetic-other' }
      ]
    }))
  })
  try {
    await view.click('Import from HackerOne')
    await view.input('#hackerone-handle', 'Synthetic')
    await view.click('Find Program')
    assert.equal(requests.length, 1)
    assert.match(view.container.textContent!, /Choose the intended program/)
    assert.equal(view.container.querySelector('img'), null)
    assert.equal(view.container.querySelector('a[href^="javascript:"]'), null)
    assert.equal(view.container.querySelector('button[type="submit"]'), null)
    await view.input('#hackerone-handle', 'Synthetic mobile')
    assert.equal(view.container.querySelector('[aria-label="Choose a HackerOne program"]'), null)
    await view.click('Find Program')
    await view.click('Synthetic mobile <img src=x>')
    assert.deepEqual(requests, [{ programQuery: 'Synthetic' }, { programQuery: 'Synthetic mobile' }, { programHandle: 'synthetic-program' }])
    assert.ok(view.container.querySelector('button[type="submit"]'))
  } finally { await view.cleanup() }
})

test('program setup shows Android tools and focus controls never alter the proposal or enable execution', async () => {
  let requests = 0
  const view = await mountForm(async () => { requests++; throw new Error('No network expected') }, undefined, { component: React.createElement(ProgramSetupPlan, { snapshot: androidSnapshot }) })
  try {
    assert.match(view.container.textContent!, /com\.example\.synthetic/)
    assert.match(view.container.textContent!, /adb|Android Debug Bridge/i)
    assert.match(view.container.textContent!, /jadx/i)
    assert.match(view.container.textContent!, /not installed/)
    assert.match(view.container.textContent!, /Execution disabled/)
    assert.ok(view.container.querySelector('[aria-label="Web and API setup proposal"]'))
    await view.click('Android (1)')
    assert.ok(view.container.querySelector('[aria-label="Android setup proposal"]'))
    assert.equal(view.container.querySelector('[aria-label="Web and API setup proposal"]'), null)
    assert.match(view.container.textContent!, /do not save an execution configuration/)
    await view.click('All target types')
    assert.ok(view.container.querySelector('[aria-label="Web and API setup proposal"]'))
    assert.equal(requests, 0)
    assert.equal(view.container.querySelector('button[type="submit"]'), null)
    assert.ok(Array.from(view.container.querySelectorAll('a')).every(link => link.href.startsWith('https://')))
  } finally { await view.cleanup() }
})

test('manual campaign entry remains available when the HackerOne connection is not configured', async () => {
  let submitted: any
  let requests = 0
  const view = await mountForm(async (_url, init) => {
    requests++
    assert.notEqual(init?.method, 'POST')
    return new Response(JSON.stringify({ success: true, configured: false, authorized: false }))
  }, async data => { submitted = data })
  try {
    assert.match(view.container.textContent!, /not configured/)
    await view.click('Manual Entry')
    await view.input('#campaign-name', 'Manual synthetic campaign')
    await view.input('#campaign-scope', 'manual.example.test')
    await act(async () => view.container.querySelector('form')!.dispatchEvent(new view.dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(submitted.name, 'Manual synthetic campaign')
    assert.equal(submitted.scope, 'manual.example.test')
    assert.equal(submitted.hackerone_handle, undefined)
    assert.equal(requests, 1)
  } finally { await view.cleanup() }
})

test('setup proposal ignores stored tool links and derives from the current scope instead', () => {
  const html = renderToStaticMarkup(React.createElement(ProgramSetupPlan, { snapshot: androidSnapshot, plan: {
    scope_sha256: 'b'.repeat(64),
    target_groups: [{ tools: [{ name: 'Untrusted tool', docs_url: 'javascript:alert(1)' }] }]
  } as any }))
  assert.match(html, /regenerated from the current snapshot/)
  assert.doesNotMatch(html, /javascript:|Untrusted tool/)
  assert.match(html, /jadx/i)
})

test('malformed legacy snapshot leaves setup unavailable instead of suggesting tools or crashing', () => {
  const malformedSnapshots = [
    { ...snapshot, sha256: 'invalid-digest' },
    { ...snapshot, assets: [{ id: 'empty-identifier', asset_identifier: '', eligible_for_submission: true }] },
    { ...snapshot, assets: [
      { id: 'duplicate-id', asset_identifier: 'first.example.test', eligible_for_submission: true },
      { id: 'duplicate-id', asset_identifier: 'second.example.test', eligible_for_submission: true }
    ] }
  ]
  for (const malformed of malformedSnapshots) {
    const html = renderToStaticMarkup(React.createElement(ProgramSetupPlan, { snapshot: malformed }))
    assert.match(html, /Setup proposal unavailable/)
    assert.match(html, /Execution remains disabled/)
    assert.doesNotMatch(html, /Suggested tools|href=/)
  }
})

test('combined setup and scope rendering survives malformed legacy arrays and rows with a refresh-required warning', () => {
  const malformedSnapshots = [
    null,
    { ...snapshot, assets: null },
    { ...snapshot, assets: [null] },
    { ...snapshot, assets: ['malformed row'] },
    { ...snapshot, assets: [[]] },
    { ...snapshot, exclusions: null },
    { ...snapshot, exclusions: [null] },
    { ...snapshot, exclusions: ['malformed row'] },
    { ...snapshot, policy: { unexpected: 'object' } }
  ]
  for (const malformed of malformedSnapshots) {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(ProgramSetupPlan, { snapshot: malformed as any }),
      React.createElement(HackerOneScopeSnapshot, { snapshot: malformed as any })
    ))
    assert.match(html, /Scope snapshot unavailable/)
    assert.match(html, /Refresh and review a complete HackerOne snapshot before setup or testing/)
    assert.match(html, /Do not rely on a partial scope list/)
    assert.doesNotMatch(html, /Full program policy|Submission-eligible assets and full notes/)
  }
})

test('missing source IDs retain the exact identifier with a display-key warning, not a fabricated provider identity', () => {
  const legacy = { ...snapshot, assets: [{ asset_identifier: 'missing-id.example.test', asset_type: 'URL', eligible_for_submission: true }] }
  const proposal = buildProgramSetupPlan(legacy)
  assert.equal(proposal.target_groups[0].assets[0].id, 'identifier:missing-id.example.test')
  assert.equal(proposal.target_groups[0].assets[0].identifier, 'missing-id.example.test')
  assert.equal('id' in legacy.assets[0], false)
  const html = renderToStaticMarkup(React.createElement(ProgramSetupPlan, { snapshot: legacy }))
  assert.match(html, /<strong>missing-id\.example\.test<\/strong>/)
  assert.match(html, /Source asset ID is missing; this is an identifier-derived display key only\./)
  assert.doesNotMatch(html, /identifier:missing-id|Setup proposal unavailable/)
})

test('no program matches provides an actionable retry message without a create action', async () => {
  const view = await mountForm(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST'
    ? { success: true, candidates: [] }
    : { success: true, configured: true, authorized: true })))
  try {
    await view.input('#hackerone-handle', 'Unknown synthetic program')
    await view.click('Find Program')
    assert.match(view.container.textContent!, /No accessible programs matched/)
    assert.match(view.container.textContent!, /Try the exact HackerOne handle/)
    assert.equal(view.container.querySelector('button[type="submit"]'), null)
  } finally { await view.cleanup() }
})
