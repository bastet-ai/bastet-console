import React, { useState } from 'react'
import { buildProgramSetupPlan, type ProgramSetupPlan as ProgramSetupPlanData, type ProgramSetupTargetKind } from '../lib/programSetupPlan'
import type { HackerOneScopeSnapshotData } from './HackerOneScopeSnapshot'

const groupLabels: Record<ProgramSetupTargetKind, string> = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web and API',
  other: 'Other targets'
}

export default function ProgramSetupPlan({ snapshot, plan }: { snapshot: HackerOneScopeSnapshotData; plan?: ProgramSetupPlanData }) {
  // Derive from the snapshot and fixed catalog, never provider text or stored tool URLs.
  const [focus, setFocus] = useState<ProgramSetupTargetKind | 'all'>('all')
  let proposal: ProgramSetupPlanData
  try {
    proposal = buildProgramSetupPlan(snapshot)
  } catch {
    return <section className="program-setup-plan" aria-label="Proposed program setup"><h3>Setup proposal unavailable</h3><p>This saved snapshot cannot be classified safely. Refresh and review a complete HackerOne snapshot before planning setup. Execution remains disabled.</p></section>
  }
  const focusedKind = proposal.target_groups.some(group => group.kind === focus) ? focus : 'all'
  const visibleGroups = proposal.target_groups.filter(group => focusedKind === 'all' || group.kind === focusedKind)

  return (
    <section className="program-setup-plan" aria-label="Proposed program setup">
      <div className="program-setup-heading">
        <h3>Proposed program setup</h3>
        <span className="badge bg-yellow-100 text-yellow-800">Needs review</span>
      </div>
      <p>Generated from the saved scope snapshot and Bastet&apos;s tool catalog. Proposed tools are not installed by this workflow. Generating this proposal does not provision devices or accounts, download apps, or start testing.</p>
      <p className="form-help">Scope SHA-256: <code>{proposal.scope_sha256}</code></p>
      {plan && plan.scope_sha256 !== snapshot.sha256 && <p role="status">The stored proposal belongs to an older scope snapshot. This view has been regenerated from the current snapshot.</p>}
      <div className="program-setup-focus" role="group" aria-label="Focus setup view">
        <button type="button" aria-pressed={focusedKind === 'all'} onClick={() => setFocus('all')}>All target types</button>
        {proposal.target_groups.map(group => <button type="button" key={group.kind} aria-pressed={focusedKind === group.kind} onClick={() => setFocus(group.kind)}>{groupLabels[group.kind]} ({group.assets.length})</button>)}
      </div>
      <p className="form-help">These controls only focus this view. They do not save an execution configuration or change program scope.</p>
      <h4>Before setup</h4>
      <ul>{proposal.prerequisites.map(item => <li key={item}>{item}</li>)}</ul>
      {!proposal.target_groups.length && <p>No supported, submission-eligible target groups were identified. Review the full scope manually before proposing a setup.</p>}
      {visibleGroups.map(group => (
        <section className="program-setup-group" key={group.kind} aria-label={`${groupLabels[group.kind]} setup proposal`}>
          <h4>{groupLabels[group.kind]}</h4>
          <details open>
            <summary>Scope evidence ({group.assets.length} assets)</summary>
            <ul className="program-setup-assets">{group.assets.map(asset => <li key={asset.id}><strong>{asset.identifier}</strong><p>{asset.evidence}</p></li>)}</ul>
          </details>
          <h5>Suggested tools</h5>
          <ul className="program-setup-tools">{group.tools.map(tool => (
            <li key={tool.id}>
              <a href={tool.docs_url} target="_blank" rel="noopener noreferrer">{tool.name}</a>
              <p>{tool.purpose}</p>
            </li>
          ))}</ul>
          <h5>Prerequisites</h5>
          <ul>{group.prerequisites.map(item => <li key={item}>{item}</li>)}</ul>
          <h5>Review requirements</h5>
          <ul>{group.review_requirements.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      ))}
      <h4>Required review for every target type</h4>
      <ul>{proposal.review_requirements.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="program-setup-safety"><strong>Execution disabled.</strong> APK acquisition, device setup, provisioning, tool installation, and testing each require separate approval. A proposal is not testing authorization or proof of runner-enforced scope controls.</p>
    </section>
  )
}
