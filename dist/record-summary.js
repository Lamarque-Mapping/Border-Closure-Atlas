/* Display-only event descriptions from the current workbook fields.
 * The workbook, its dates and its research qualifications remain unchanged. */
(function(root){
  'use strict';
  const array=v=>Array.isArray(v)?v:[];
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const known=v=>{const s=clean(v);return s&&!/^(?:not (?:separately |fully |individually )?established|unknown|unresolved|none|n\/a)(?:\b|$)/i.test(s)?s:'';};
  const words=s=>clean(s).split(/\s+/).filter(Boolean).length;
  const sentence=s=>{s=clean(s).replace(/[;,:\s]+$/,'');return s?(/[.!?]$/.test(s)?s:s+'.'):'';};
  const lowerFirst=s=>s.replace(/^(All|Among|Authorized|Bilateral|Border|Both|Cargo|Commercial|Cross-border|Dispute|Entry|Exit|Foreign|Foreigners|Freight|Goods|Incoming|Intentional|International|Lack|Land|Movement|National|Non-essential|Non-exempt|Opposition|Ordinary|Outgoing|Participating|Passenger|Passengers|Pedestrian|People|Precautionary|Regional|Reported|Road|Security|Selected|Selective|The|Travel|Travellers|Trucks|Two|Users|Vehicles|Whole)\b/,m=>m.toLowerCase());
  const sentences=value=>clean(value).split(/(?<=[.!?])\s+(?=[A-Z“"0-9])/).map(clean).filter(Boolean);
  const firstClause=value=>clean(value).split(';')[0].replace(/[.\s]+$/,'');
  function readable(value){
    return clean(value)
      .replace(/Two calendar-day difference is not an exact hourly measure\./gi,'The dates are two days apart; the exact hours are not established.')
      .replace(/Same calendar day is a scheduled window, not measured elapsed time\./gi,'The order covered one date; its length in hours is not established.')
      .replace(/, immaterial to calendar-day precision/gi,'')
      .replace(/\bcalendar-day differences?\b/gi,'days')
      .replace(/\bcalendar(?:-date)? (days?)\b/gi,'$1')
      .replace(/\bcalendar[- ]dates?\b/gi,'dates')
      .replace(/\bcalendar-day\b/gi,'day')
      .replace(/Both outlets interview the same officer; two articles are one principal operational origin\./g,'Both articles rely on the same officer’s account.')
      .replace(/Exact hours and exemptions unreported\./g,'Exact hours and exceptions were not reported.')
      .replace(/; quarantined from analysis pending mechanism evidence\./g,'.')
      .replace(/Last-confirmed segment, not reopening\./g,'The last date confirms closure, not reopening.')
      .replace(/\bscoped ordinary-passenger policy phase\b/gi,'policy applying to ordinary passengers')
      .replace(/\bscoped (?:operational )?(?:duration|interval|spell)\b/gi,'duration for the specified crossing and traffic')
      .replace(/\boperational continuity\b/gi,'uninterrupted closure')
      .replace(/\bcontinuity\b/gi,'uninterrupted closure')
      .replace(/\bparent record\b/gi,'record')
      .replace(/\bendpoint\b/gi,'end date')
      .replace(/\bchronology phases?\b/gi,'separate periods')
      .replace(/\bnumeric duration withheld\b/gi,'duration not established')
      .replace(/\bwhole-day duration\b/gi,'full day of closure')
      .replace(/(\b(?:January|February|March|April|May|June|July|August|September|October|November|December))(?=\d)/g,'$1 ')
      .replace(/\bscoped endpoint only\b/gi,'for the stated traffic and location')
      .replace(/\bdate-boundary difference\b/gi,'difference between dates')
      .replace(/\bNo proof of\b/gi,'No evidence establishes');
  }
  // These descriptions resolve particularly easy-to-misread records using the
  // current phase text and corrections. They are prose summaries, not new data.
  const descriptions=Object.freeze({
    GL01:'Rwanda restricted travel by some of its nationals to Uganda, while foreigners and later specified cargo and returnees could cross. Reporting records refusals and selective permission at Gatuna/Katuna and Kagitumba/Mirama Hills. Rwanda cited alleged insecurity; Uganda disputed Rwanda’s broader allegations. Truck diversions and reopening trials had separate scopes and remain contested. The dated passenger observations do not show an uninterrupted 2019–2022 closure of all traffic.',
    'FU-COV-EAS-003':'The seasonal Mazongshan–Naran Sevstei crossing between China and Mongolia was suspended following Mongolia’s request to protect a nature reserve, according to the Chinese official port history. The chronology also records August 2021 reporting that it had not reopened. This concerns one crossing, not the whole China–Mongolia border. Seasonal operating gaps do not provide a continuous closure duration, and the evidence does not establish its status after that report.',
    'R16-AN-001':'Senegalese freight vehicles faced restrictions on entering Mauritania, with cargo transferred to local trucks at Rosso. Reciprocal restrictions on Mauritanian vehicles appear in participant accounts, although institutional confirmation specifically covers travel from Senegal to Mauritania. Cargo itself was not banned. The original start, uninterrupted enforcement and application at other crossings remain uncertain; the July 2025 legal change is distinct from later reporting of lifting.',
    EU022:'Norway restricted entry by foreign nationals outside exempt categories to prevent COVID-19 transmission. The policy applied to land arrivals as part of a wider national entry regime. The chronology separates the first regulation from its successor framework on 1 July 2020. Those dates mark legal changes; they do not establish that every land crossing was physically closed throughout. Exemptions changed, and later tightening and final repeal are not fully reconstructed.',
    H06:'Restrictions affected passengers and trade at designated crossings between Sudan and South Sudan, amid deteriorating relations and border disputes. The accounts describe changing conditions: a January 2016 reopening order, functioning corridors reported by the UN in April 2021, and an official reopening launch that failed to take place in October 2021. These accounts do not establish one continuous closure from 2011 to 2021. The later status of individual crossings remains uncertain.',
    'R8-AS-001':'The Rishtan–Kaytpas crossing between Uzbekistan and Kyrgyzstan experienced restrictions after the January 2013 Charbak incident. September 2017 reporting describes an intermediate opening and renewed closure, followed by a later partial restoration for Kyrgyz and Uzbek citizens. That restoration did not reopen the full route to Sokh because Apkan remained closed. The evidence does not establish an uninterrupted 2013–2017 closure or the same conditions for all travellers and goods.',
    'R3-EU-004':'Polish protesters obstructed commercial freight at the Ukrainian border while seeking changes to haulage access and permit arrangements. The current dated evidence concerns Korczowa; humanitarian and military consignments continued to pass. Dorohusk had an interruption in its blockade, so it cannot share the same continuous duration. Queues that remained after clearance do not establish continued closure, and the separate farmers’ protest at Medyka is excluded from this period.',
    SC12:'Botswana restricted ordinary passenger travel across its land borders during the COVID-19 pandemic, while allowing freight and defined essential movement. The 252-day period in the chronology applies specifically to ordinary passengers at Tlokweng. A notice scheduled ground-border reopening for 1 December, and actual traffic at Tlokweng is documented separately. Other crossing points have policy or reporting evidence, without the same direct confirmation at each gate.',
    'R2-ME-010':'During armed hostilities, restrictions affected access through Gaza’s Israeli-controlled crossings. The current dated evidence concerns Palestinian patients with medical referrals seeking passage through Erez. Aid openings at Kerem Shalom and access for international personnel do not establish that those patients could cross. The last documented date confirms continuing restrictions for this group; it is not a reopening date. A specific official closure order was not recovered.',
    ME033:'During regional escalation, restrictions affected movements through Israeli-controlled crossings into Gaza. The current chronology follows fuel and aid movements at Kerem Shalom, with a limited reopening reported on 3 March. Other crossings remained closed, so that date is not a general reopening of Gaza. The detailed Israeli order was not retrieved. The separate Rafah crossing is excluded from this record.',
    'R15-SM-003':'Drivers blocked incoming cargo trucks at Hili on the India–Bangladesh border, demanding that rice be unloaded from vehicles stranded inside Bangladesh. The initial action on 2 July was lifted, and ten trucks entered on 3 July before the blockade resumed. The current period follows that renewed cargo blockade to documented entry on 5 July. It does not describe a continuous 2–5 July closure or a halt to passenger travel.',
    SC14:'Malawi announced a land-border closure affecting foreign travellers and non-essential goods to curb COVID-19 transmission. Returning Malawian citizens and essential-service providers were excepted. Accounts differ over whether the order took effect on 22 or 23 December. It was announced for fourteen days, but the evidence does not establish uninterrupted enforcement or an observed reopening at the end of that planned period.'
  });
  // A replacement workbook must never inherit editorial text for an older
  // record. These descriptions apply only to the exact reviewed source record;
  // changed records fall back to their newly imported current fields.
  const descriptionHashes=Object.freeze({
    EU022:'21c35d7d251be32aa724b5c672f2289f8fb490883b902aa675adfc61dcae5a4c',
    GL01:'9c9e6a17200b78097bc980979d975661bc85edd31191ddbb0c650dba8dd3d502',
    H06:'6297aca33ed6032870e32236bcbd1e121f4821ee15bc7723317056dc742cdb39',
    ME033:'ff0423df6688709e9f186e5ab7432b97eb9004dde94d543a0911f76661c7ea43',
    SC14:'3934fef8e8f842603e445dd595a167eecec836a803b9d4431290a1427a34c3de',
    SC12:'622af8dd696310fc5f0987380195d3593fcc8f422fa77c58f9a598c39d5cb995',
    'R2-ME-010':'03a12879865c445b9aef10a2b92c4e354d9a62c4f8f213e5606525478958f3db',
    'R3-EU-004':'aef9bbca965405b6a734f57f621c3dc5c5d604cd5cec36547136fbfe4c2b946b',
    'R8-AS-001':'1b10f7a5dc13a66ff78449512d1cd2f75f652b845e92c427f634d66b8d8891bc',
    'R15-SM-003':'9b3f6ef1697f7beb517a1ebbbcabbaa41f7e9c41e4805e9fd75c331cc34f67c4',
    'R16-AN-001':'019d003d93049599802b3e38caa8466a1a4ea38ab4465803f02f24cc8f14ae44',
    'FU-COV-EAS-003':'82aa49d14762bc480ec69f1fbaa2f059af514b7224eda8306ec830c8e547b103'
  });
  function rationaleSentence(e){
    let reason=sentences(known(e.official_rationale))[0]||'';
    if(!reason||words(reason)>45)return '';
    reason=readable(reason).replace(/[.]+$/,'');
    if(/^(?:No |Not |Specific .*not |[A-Z][\w’'-]*(?:\s+[A-Z][\w’'-]*){0,4}\s+(?:alleged|cited|demanded|reported|sought|protested|attributed|said|called))/i.test(reason))return sentence(reason);
    if(/^(Prevent|Protect|Control|Contain|Reduce|Stop|Ensure|Manage|Enforce|Deter|Limit|Respond)\b/i.test(reason))return sentence('The stated purpose was to '+reason[0].toLowerCase()+reason.slice(1));
    if(/^(?:\w+\s+){0,5}(?:cited|demanded|alleged|protested|sought|attributes?|attributed)\b/i.test(reason))return sentence(reason);
    return sentence('The reported reason was '+lowerFirst(reason));
  }
  function timingQualification(periods){
    if(!periods.length)return 'A reliable period of closure has not been established.';
    if(periods.every(p=>p.contested))return 'The accounts are disputed, so these dates do not establish a confirmed period of closure.';
    if(periods.every(p=>p.temporal_display_rule==='dated_evidence_only_no_continuity_inference'))return 'The evidence describes particular dates; it does not establish an uninterrupted closure between them.';
    if(periods.every(p=>p.measure_type==='ordered_window'))return 'These are announced dates; enforcement throughout the planned period is not confirmed.';
    if(periods.every(p=>p.measure_type==='intermittent_regime'))return 'The period includes openings and cannot be counted as days continuously closed.';
    if(periods.every(p=>p.measure_type==='formal_policy_period'))return 'The dates track a rule in force; they do not establish uninterrupted closure on the ground.';
    if(periods.some(p=>p.temporal_display_rule==='censored_interval_stop_at_last_confirmation_unknown_afterward')&&periods.every(p=>p.observed_reopening!=='Yes'))return 'Reopening is not established after the last documented closure date.';
    return '';
  }
  function usefulQualifications(e,periods){
    const phaseNotes=periods.map(p=>p.qualification).filter(v=>clean(v));
    // A newer phase can correct a parent-level uncertainty note. Do not use a
    // historical parent qualification to fill space when phase wording exists.
    const raw=phaseNotes.length?phaseNotes:[e.uncertainty];
    const output=[];
    for(const value of raw)for(let part of sentences(value)){
      if(/(?:\b(?:taxonomy|codebook|source IDs?|coordinates?|mapping|phase ID|filter|column|workbook|field-level|same-model|current cutoff|current WHO-page)\b|\b(?:R\d+-|GL\d+|FU-COV-)[A-Z\d-]*|^Not established\.?$|^Keep |^Preserve |^See |^Do not |^No (?:pooled|aggregate) |source access|retrieval|retrieved|timed out|indexed text|direct open|round \d)/i.test(part))continue;
      part=readable(part);
      if(/\b(?:parent|numeric|lineage|operational origin|scoped|bounds|boundary|boundaries|calendar-date|calendar date|newly inspected|country-level reported action|reporting-supported segment|regime|phase|geographic generalisation|intermediate|quantified|censored|independence|legal characterisations|double counting|duplicate Africa coding)\b|^Attributed .*observation only\./i.test(part))continue;
      if(words(part)>45||words(part)<3||output.includes(sentence(part)))continue;
      output.push(sentence(part));
    }
    return output;
  }
  function describe(e,options={}){
    if(!e)return '';
    if(e.record_kind==='national_policy')return e.national_summary;
    const periods=(Array.isArray(options.periods)?options.periods:array(e.duration_periods)).filter(p=>p.analysis_included!==false);
    if(e.audit_current||e.audited_reader){
      // Accepted scope includes its own exclusions and direction limits. Keep
      // the complete field rather than stitching older parent attributes into
      // new claims or truncating a qualifying clause at a semicolon.
      const scope=known(periods.length===1?periods[0].scope:'')||known(e.audited_reader?.['Crossing and scope'])||known(e.scope);
      const parts=[scope?sentence('Recorded scope: '+readable(scope)):'The precise location and affected traffic are not established.'];
      const movement=known(periods.length===1?periods[0].movement:'');
      if(movement&&!clean(scope).toLowerCase().includes(clean(movement).toLowerCase()))parts.push(sentence('Affected movement: '+readable(movement)));
      if(e.quarantined||e.inclusion_status==='Excluded'||e.inclusion_status==='Quarantined')parts.push('This entry is excluded from the analysis.');
      const qualification=timingQualification(periods);if(qualification)parts.push(qualification);
      parts.push('Dates, exceptions and evidence limits are recorded separately for each dated stage.');
      return parts.join(' ');
    }
    if(descriptions[e.id]&&descriptionHashes[e.id]===e.event_hash)return descriptions[e.id];
    const scope=known(e.scope),movement=known(periods.length===1?periods[0].movement:'')||known(e.movement),crossings=known(e.crossings),parts=[];
    const allPolicy=periods.length&&periods.every(p=>p.measure_type==='formal_policy_period');
    const allOrdered=periods.length&&periods.every(p=>p.measure_type==='ordered_window');
    const held=periods.length&&periods.every(p=>p.contested);
    const noun=allOrdered?'The announced restriction':allPolicy?'The policy':held?'The reported restriction':'The restriction';
    let place=firstClause(crossings).replace(/^Among reported gates:\s*/i,'');
    if(periods.length===1){
      // A parent can mention several posts while its only timed evidence refers
      // to one of them. Match a named post to the positive scope text; otherwise
      // leave geography to the title and the separately displayed scope field.
      const normal=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const positive=normal(periods[0].scope).split(/\b(?:not |exclud(?:es|ing) )/)[0];
      const candidates=crossings.split(/;|\s+and\s+/).map(s=>clean(s).replace(/^(?:Among reported gates:|endpoint at)\s*/i,''));
      const matched=candidates.filter(s=>{const token=normal(s).match(/^[a-z\d'-]{4,}/)?.[0];return token&&!/^(?:border|land|national|named|crossing|external|official|other|not|all)$/.test(token)&&positive.includes(token);});
      place=matched.length?matched.join(' and '):'';
    }
    if(/^(?:Nationwide|National|All |Not )/i.test(place)||words(place)>24)place='';
    let affected=firstClause(movement).replace(/\s+initially halted$/i,'');
    if(words(affected)>28)affected='';
    if(place)parts.push(sentence(noun+' affected '+(affected?lowerFirst(readable(affected)):'cross-border passage')+' at '+lowerFirst(readable(place))));
    else if(affected)parts.push(sentence(noun+' affected '+lowerFirst(readable(affected))));
    else if(scope&&words(firstClause(scope))<=32)parts.push(sentence(noun+' covered '+lowerFirst(readable(firstClause(scope)))));
    if(!parts.length)parts.push('The precise location and affected traffic are not established.');
    const reason=rationaleSentence(e);if(reason)parts.push(reason);
    const qualification=timingQualification(periods),notes=usefulQualifications(e,periods);
    if(e.quarantined||e.inclusion_status==='Excluded'||e.inclusion_status==='Quarantined'){
      parts.push('This entry is excluded from the analysis.');
    }
    // Prefer the source-specific limit over a second generic warning. Include a
    // timing limit where it changes what readers may infer from the dates.
    const candidates=[...notes.slice(0,2),qualification].filter(Boolean);
    for(const note of candidates){
      if(parts.some(p=>p.toLowerCase()===note.toLowerCase()))continue;
      if(words(parts.join(' '))+words(note)>110&&parts.length>2)continue;
      parts.push(note);
    }
    if(qualification&&!parts.includes(qualification)&&words(parts.join(' '))<85)parts.push(qualification);
    return parts.join(' ');
  }
  const api=Object.freeze({describe});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.BorderSummary=api;
})(typeof window!=='undefined'?window:globalThis);

