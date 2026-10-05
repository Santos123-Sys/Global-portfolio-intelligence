'use client';
import {
  emptyThesisPolicy,
  type ThesisPolicy,
  type ThesisRule,
} from '@portfolio-intelligence/agentic-contract';

const geography = [
  ['listingMarkets', 'Listing markets (MICs, e.g. BVMF or XSWX)'],
  ['domicileCountries', 'Company domicile (ISO codes, e.g. BR or CH)'],
  ['operatingCountries', 'Operating geography (ISO codes)'],
  ['revenueCountries', 'Revenue exposure (ISO codes)'],
  ['securityTypes', 'Security types (provider labels)'],
  ['sectorsIncluded', 'Required sectors'],
  ['sectorsExcluded', 'Excluded sectors'],
  ['industriesIncluded', 'Required industries'],
  ['industriesExcluded', 'Excluded industries'],
] as const;

export function ThesisPolicyEditor({ policy, onChange }: { policy?: ThesisPolicy; onChange: (p: ThesisPolicy) => void }) {
  if (!policy) return <div>
    <p className="note">These extracted criteria remain prose. Add a structured policy to control eligibility and distinguish preferences from context.</p>
    <button className="secondary-button" type="button" onClick={() => onChange(emptyThesisPolicy())}>Structure this mandate</button>
  </div>;

  const updateRule = (index: number, patch: Partial<ThesisRule>) => onChange({
    ...policy,
    rules: policy.rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule),
  });

  return <div className="setup-form">
    <details>
      <summary>Research language and optional value lens</summary>
      <p className="note">The scorecard is a sector-relative research lens, not a buy/sell rule. Changes are saved with the approved thesis. Missing evidence is not scored as poor performance.</p>
      <label>Research language<select value={policy.research?.locale ?? 'en'} onChange={event=>onChange({...policy,research:{...policy.research,locale:event.target.value as 'pt-BR'|'en'|'de'|'es'}})}><option value="en">English</option><option value="pt-BR">Português (Brasil)</option><option value="de">Deutsch</option><option value="es">Español</option></select></label>
      <label><input type="checkbox" checked={policy.research?.valueScorecard?.enabled ?? false} onChange={event=>onChange({...policy,research:{locale:policy.research?.locale ?? 'en',valueScorecard:{enabled:event.target.checked,weights:policy.research?.valueScorecard?.weights ?? {moat:.25,management:.25,financials:.25,valuation:.25},minimumEvidenceCoverage:policy.research?.valueScorecard?.minimumEvidenceCoverage ?? .8}}})}/>Enable Value Quality Scorecard</label>
      {policy.research?.valueScorecard?.enabled && <div className="setup-form-row">{(['moat','management','financials','valuation'] as const).map(dimension=><label key={dimension}>{dimension} weight (%)<input type="number" min="0" max="100" value={policy.research!.valueScorecard!.weights[dimension]*100} onChange={event=>onChange({...policy,research:{...policy.research!,valueScorecard:{...policy.research!.valueScorecard!,weights:{...policy.research!.valueScorecard!.weights,[dimension]:Number(event.target.value)/100}}}})}/></label>)}<label>Required evidence coverage (%)<input type="number" min="50" max="100" value={policy.research.valueScorecard.minimumEvidenceCoverage*100} onChange={event=>onChange({...policy,research:{...policy.research!,valueScorecard:{...policy.research!.valueScorecard!,minimumEvidenceCoverage:Number(event.target.value)/100}}})}/></label><p className="note">Weights must sum to 100%. Automatic totals require verified financial data; final decisions always require human review.</p></div>}
    </details>

    <details>
      <summary>Mandate and portfolio rules</summary>
      <div className="setup-form-row">
        {([['name','Portfolio name'],['strategy','Strategy'],['benchmark','Benchmark (optional)'],['horizon','Investment horizon']] as const).map(([field,label])=><label key={field}>{label}<input value={policy[field] ?? ''} onChange={event=>onChange({...policy,[field]:event.target.value || undefined})}/></label>)}
        {([['targetHoldings','Target holdings'],['maximumHoldings','Maximum holdings']] as const).map(([field,label])=><label key={field}>{label}<input type="number" min="1" max="1000" step="1" value={policy[field] ?? ''} onChange={event=>onChange({...policy,[field]:event.target.value===''?undefined:Number(event.target.value)})}/></label>)}
      </div>
      <p className="note">Holdings describe the portfolio mandate; the Discovery shortlist limit is a separate research setting.</p>
    </details>

    <details>
      <summary>Eligible universe</summary>
      <p className="note">Each populated field is a hard restriction. Alternatives within a field use OR; separate fields use AND. Leave a field empty for no restriction. Reporting currency never determines geography. Operating/revenue fields require explicit provider evidence.</p>
      <div className="setup-form-row">
        {geography.slice(0,2).map(([field,label])=><label key={field}>{label}<textarea rows={2} value={policy.universe[field].join('\n')} onChange={event=>onChange({...policy,universe:{...policy.universe,[field]:event.target.value.split('\n')}})}/></label>)}
      </div>
      <details><summary>Operating / revenue exposure, security types and sector restrictions</summary><div className="setup-form-row">
        {geography.slice(2).map(([field,label])=><label key={field}>{label}<textarea rows={2} value={policy.universe[field].join('\n')} onChange={event=>onChange({...policy,universe:{...policy.universe,[field]:event.target.value.split('\n')}})}/></label>)}
      </div></details>
      <p className="note">One value per line. Current automated markets: B3 (BVMF) and SIX (XSWX). Provider labels for sectors and security types must match exactly, ignoring case.</p>
    </details>

    <details>
      <summary>Selection, macro, risk and valuation rules</summary>
      <p className="note">Hard = eligibility requirement. Preference = ranking consideration. Context = analysis assumption. A hard rule must have an explicit numeric, attribute or evidence predicate before Discovery can certify it.</p>
      {policy.rules.map((rule,index)=><fieldset key={index} className="thesis-mandate">
        <legend>Rule {index+1}</legend>
        <label>Statement<textarea value={rule.statement} onChange={event=>updateRule(index,{statement:event.target.value})}/></label>
        <div className="setup-form-row">
          <label>Effect<select value={rule.kind} onChange={event=>updateRule(index,{kind:event.target.value as ThesisRule['kind']})}><option value="hard">Hard constraint</option><option value="preference">Preference</option><option value="context">Contextual assumption</option></select></label>
          <label>Category<select value={rule.category} onChange={event=>updateRule(index,{category:event.target.value as ThesisRule['category']})}>{['selection','macro','sector','risk','valuation'].map(value=><option key={value}>{value}</option>)}</select></label>
        </div>

        <details>
          <summary>Enforcement predicate</summary>
          <p className="note">Choose exactly one predicate. Numeric metrics enforce thresholds. Provider attributes enforce categorical facts. Evidence gates additionally require source lineage and optional freshness—for example, current judicial-recovery status from an official source.</p>
          {!rule.metric && !rule.predicate && <div className="workflow-actions">
            <button type="button" className="secondary-button" onClick={()=>updateRule(index,{metric:{field:'',unit:'',period:'',operator:'gte',value:NaN}})}>Add numeric metric</button>
            <button type="button" className="secondary-button" onClick={()=>updateRule(index,{predicate:{mode:'attribute',field:'',operator:'eq',value:''}})}>Add provider attribute</button>
            {rule.kind==='hard' && <button type="button" className="secondary-button" onClick={()=>updateRule(index,{predicate:{mode:'evidence',field:'',operator:'eq',value:'',sourceRequirement:'official',maxAgeDays:90}})}>Add evidence gate</button>}
          </div>}
          {rule.metric && <>
            <div className="setup-form-row">
              {(['field','unit','period'] as const).map(field=><label key={field}>{field==='field'?'Provider metric key':field==='unit'?'Unit or currency':'Measurement period'}<input value={rule.metric![field]} onChange={event=>updateRule(index,{metric:{...rule.metric!,[field]:event.target.value}})}/></label>)}
              <label>Comparison<select value={rule.metric.operator} onChange={event=>updateRule(index,{metric:{...rule.metric!,operator:event.target.value as 'gte'|'lte'}})}><option value="gte">At least</option><option value="lte">At most</option></select></label>
              <label>Threshold<input type="number" step="any" value={Number.isFinite(rule.metric.value)?rule.metric.value:''} onChange={event=>updateRule(index,{metric:{...rule.metric!,value:event.target.value===''?NaN:Number(event.target.value)}})}/></label>
            </div>
            <button type="button" className="secondary-button" onClick={()=>updateRule(index,{metric:undefined})}>Remove numeric predicate</button>
          </>}
          {rule.predicate && <>
            <div className="setup-form-row">
              <label>Predicate type<select value={rule.predicate.mode} onChange={event=>updateRule(index,{predicate:event.target.value==='evidence'?{...rule.predicate!,mode:'evidence',sourceRequirement:'official',maxAgeDays:rule.predicate!.maxAgeDays ?? 90}:{mode:'attribute',field:rule.predicate!.field,operator:rule.predicate!.operator,value:rule.predicate!.value}})}><option value="attribute">Provider attribute</option>{rule.kind==='hard' && <option value="evidence">Evidence gate</option>}</select></label>
              <label>Field<input value={rule.predicate.field} placeholder="judicial_recovery_status" onChange={event=>updateRule(index,{predicate:{...rule.predicate!,field:event.target.value}})}/></label>
              <label>Comparison<select value={rule.predicate.operator} onChange={event=>updateRule(index,{predicate:{...rule.predicate!,operator:event.target.value as 'eq'|'neq'}})}><option value="eq">Must equal</option><option value="neq">Must not equal</option></select></label>
              <label>Expected value<input value={rule.predicate.value} placeholder="none" onChange={event=>updateRule(index,{predicate:{...rule.predicate!,value:event.target.value}})}/></label>
              {rule.predicate.mode==='evidence' && <><label>Source requirement<select value={rule.predicate.sourceRequirement ?? 'official'} onChange={event=>updateRule(index,{predicate:{...rule.predicate!,sourceRequirement:event.target.value as 'provider'|'official'}})}><option value="official">Official / regulatory evidence</option><option value="provider">Provider evidence</option></select></label><label>Maximum evidence age (days)<input type="number" min="1" max="3650" value={rule.predicate.maxAgeDays ?? ''} onChange={event=>updateRule(index,{predicate:{...rule.predicate!,maxAgeDays:event.target.value===''?undefined:Number(event.target.value)}})}/></label></>}
            </div>
            <p className="note">Evidence fields use companion lineage attributes: <code>{rule.predicate.field || 'field'}_source_url</code>, <code>_source_kind</code> and <code>_observed_at</code>. Missing or stale evidence yields “unverified”; it never passes a hard gate silently.</p>
            <button type="button" className="secondary-button" onClick={()=>updateRule(index,{predicate:undefined})}>Remove categorical/evidence predicate</button>
          </>}
        </details>

        <button type="button" className="secondary-button" onClick={()=>onChange({...policy,rules:policy.rules.filter((_,position)=>position!==index)})}>Remove rule {index+1}</button>
      </fieldset>)}
      <button type="button" className="secondary-button" onClick={()=>onChange({...policy,rules:[...policy.rules,{statement:'',kind:'preference',category:'selection'}]})}>Add classified rule</button>
    </details>
  </div>;
}
