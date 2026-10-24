(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const dateDialog=$('date-dialog'),year=$('date-year'),month=$('date-month');
  let minimum=0,maximum=0;
  function monthOptions(preferred){
    const chosenYear=Number(year.value),first=Math.max(0,minimum-chosenYear*12),last=Math.min(11,maximum-chosenYear*12);
    month.innerHTML=Array.from({length:12},(_,n)=>'<option value="'+n+'"'+(n<first||n>last?' disabled':'')+'>'+new Date(Date.UTC(2020,n,1)).toLocaleDateString('en-GB',{month:'long',timeZone:'UTC'})+'</option>').join('');
    month.value=String(Math.max(first,Math.min(last,Number(preferred))));
  }
  $('month-label').addEventListener('click',()=>{
    const viewer=window.BORDER_VIEWER,data=viewer?.getData();if(!data)return;
    minimum=Number($('month-slider').min);maximum=Number($('month-slider').max);
    const selected=viewer.getState().month,firstYear=Math.floor(minimum/12),lastYear=Math.floor(maximum/12);
    year.innerHTML=Array.from({length:lastYear-firstYear+1},(_,i)=>'<option value="'+(firstYear+i)+'">'+(firstYear+i)+'</option>').join('');
    year.value=String(Math.floor(selected/12));monthOptions(selected%12);
    dateDialog.showModal();year.focus();
  });
  year.addEventListener('change',()=>monthOptions(month.value));
  $('date-close').addEventListener('click',()=>dateDialog.close());
  $('date-form').addEventListener('submit',event=>{
    event.preventDefault();const selected=Number(year.value)*12+Number(month.value);
    if(!Number.isInteger(selected)||selected<minimum||selected>maximum)return;
    window.BORDER_VIEWER.selectMonth(selected);dateDialog.close();$('month-label').focus();
  });
  const accessed=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'});
  const reference='Lamarque, H. (2026) Global Border Closures Atlas. Available at: https://lamarque-mapping.github.io/Border-Closure-Atlas/ (Accessed: '+accessed+').';
  document.querySelectorAll('[data-access-date]').forEach(node=>{node.textContent=accessed;});
  const citation=$('citation-dialog');
  document.querySelectorAll('[data-cite]').forEach(button=>button.addEventListener('click',()=>citation.showModal()));
  $('citation-close').addEventListener('click',()=>citation.close());
  document.querySelectorAll('[data-copy-citation]').forEach(button=>button.addEventListener('click',async()=>{
    const original=button.textContent;
    try{await navigator.clipboard.writeText(reference);button.textContent='Reference copied';}
    catch{
      const text=button.parentNode.querySelector('[data-citation]'),selection=window.getSelection(),range=document.createRange();
      if(text&&selection){range.selectNodeContents(text);selection.removeAllRanges();selection.addRange(range);}
      button.textContent='Select and copy the reference above';
    }
    setTimeout(()=>{button.textContent=original;},2500);
  }));
  for(const dialog of [dateDialog,citation])dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
  });
  window.addEventListener('atlas:pagechange',()=>{if(dateDialog.open)dateDialog.close();});
})();
