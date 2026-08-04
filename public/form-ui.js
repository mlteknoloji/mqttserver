window.netrelayCopyText=async function(value){
  const text=String(value??'');
  if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return}
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.left='-9999px';area.style.opacity='0';
  document.body.append(area);
  try{area.focus();area.select();area.setSelectionRange(0,area.value.length);if(!document.execCommand('copy'))throw new Error('Kopyalama desteklenmiyor.')}finally{area.remove()}
};

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.standalone-shell .panel form label > small').forEach(description=>{
    const text=description.textContent.trim();
    if(!text||description.closest('.relay-ios-copy'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='help-tooltip form-help-tooltip';
    button.dataset.tooltip=text;
    button.setAttribute('aria-label',text);
    button.textContent='i';
    description.replaceWith(button);
  });
  document.querySelectorAll('.help-tooltip').forEach(button=>button.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
  }));

  const icons={
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm12.5-16.5 4 4 1-1a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-1 1Z"/></svg>',
    remove:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z"/></svg>'
  };
  function upgradeActionButtons(root=document){
    root.querySelectorAll?.('button').forEach(button=>{
      if(button.classList.contains('icon-action-button'))return;
      const text=button.textContent.trim().toLocaleLowerCase('tr-TR');
      const action=button.dataset.action||'';
      const kind=(text==='düzenle'||action==='edit')?'edit':(text==='sil'||action==='remove'||button.hasAttribute('data-remove')||button.hasAttribute('data-firmware-remove'))?'remove':null;
      if(!kind)return;
      const label=kind==='edit'?'Düzenle':'Sil';
      button.classList.add('icon-action-button',`icon-action-${kind}`);
      button.setAttribute('aria-label',label);
      button.title=label;
      button.innerHTML=icons[kind];
    });
  }
  upgradeActionButtons();
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType!==1)return;
    if(node.matches?.('button'))upgradeActionButtons(node.parentElement);
    else upgradeActionButtons(node);
  }))).observe(document.body,{childList:true,subtree:true});
});
