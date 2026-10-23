/* Display-only plain language and unit formatting. Research data stays unchanged. */
(function(root){
  'use strict';
  const asText=value=>Array.isArray(value)?value.join('; '):value&&typeof value==='object'?JSON.stringify(value):String(value??'');
  function text(value){
    return asText(value)
      .replace(/(\d)(calendar)/gi,'$1 $2')
      .replace(/\bcalendar-day differences?\b/gi,'days')
      .replace(/;\s*scoped endpoint only\b/gi,'; for the stated movement and location')
      .replace(/\bcalendar(?:-date)? (days?)\b/gi,'$1')
      .replace(/\s+to (?:the )?scoped endpoint\b/gi,'')
      .replace(/\bscoped endpoint(s?)\b/gi,'endpoint$1')
      .replace(/\bFormal policy:\s*/gi,'Policy: ')
      .replace(/\b(days?) in policy period\b/gi,'$1')
      .replace(/\boperational continuity not established\b/gi,'continuous closure not confirmed')
      .replace(/\boperational continuity\b/gi,'continuous closure')
      .replace(/\b1 days\b/g,'1 day');
  }
  root.BorderPublic=Object.freeze({text});
})(typeof window!=='undefined'?window:globalThis);
