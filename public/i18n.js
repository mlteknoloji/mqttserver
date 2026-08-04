(function(){
  const STORAGE_KEY='netrelay-language';
  const DEFAULT_LANGUAGE='tr';
  const skippedTags=new Set(['SCRIPT','STYLE','CODE','PRE','TEXTAREA']);
  let translations={},templates=[],language=localStorage.getItem(STORAGE_KEY)||DEFAULT_LANGUAGE;

  function translated(value){
    const original=String(value||''),trimmed=original.trim();
    if(!trimmed)return original;
    let result=translations[trimmed];
    if(!result){
      for(const template of templates){
        const match=trimmed.match(template.pattern);if(!match)continue;
        result=template.value.replace(/\{\{(\w+)\}\}/g,(_,name)=>match[template.names.indexOf(name)+1]??'');break;
      }
    }
    if(!result&&language==='en')result=trimmed
      .replace(/^Röle (\d+)$/, 'Relay $1')
      .replace(/(\d+) cihaz$/, '$1 devices')
      .replace(/^(\d+) anahtar$/, '$1 keys')
      .replace(/ \(çevrimiçi\)$/, ' (online)');
    if(!result||result===trimmed)return original;
    return original.replace(trimmed,result);
  }

  function translateElement(root){
    if(language===DEFAULT_LANGUAGE)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
      const parent=node.parentElement;
      return !parent||(skippedTags.has(parent.tagName)&&!parent.closest('[data-i18n-translate]'))||parent.closest('[data-i18n-ignore]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;
    }});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{node.nodeValue=translated(node.nodeValue)});
    const elements=root.nodeType===1?[root,...root.querySelectorAll('*')]:[...document.querySelectorAll('*')];
    elements.forEach(element=>{
      if((skippedTags.has(element.tagName)&&!element.closest('[data-i18n-translate]'))||element.closest('[data-i18n-ignore]'))return;
      ['placeholder','title','aria-label','data-tooltip'].forEach(attribute=>{
        if(element.hasAttribute?.(attribute))element.setAttribute(attribute,translated(element.getAttribute(attribute)));
      });
    });
    document.title=translated(document.title);
  }

  function addLanguageControl(locales){
    const host=document.querySelector('.sidebar-footer')||document.querySelector('.auth-card');
    if(!host||document.getElementById('language-select'))return;
    const label=document.createElement('label');label.className='language-control';
    const caption=document.createElement('span');caption.textContent=translations.Dil||'Dil';
    const select=document.createElement('select');select.id='language-select';select.setAttribute('aria-label',caption.textContent);
    locales.forEach(locale=>select.add(new Option(`${locale.flag?`${locale.flag} `:''}${locale.shortName||locale.code.toUpperCase()}`,locale.code,false,locale.code===language)));
    select.onchange=()=>{localStorage.setItem(STORAGE_KEY,select.value);document.cookie=`netrelay_language=${encodeURIComponent(select.value)}; Path=/; Max-Age=31536000; SameSite=Lax`;location.reload()};
    label.append(caption,select);host.prepend(label);
  }

  async function initialize(){
    try{
      const locales=await fetch('/locales/index.json',{cache:'no-cache'}).then(response=>response.json());
      if(!locales.some(locale=>locale.code===language))language=DEFAULT_LANGUAGE;
      const locale=await fetch(`/locales/${language}.json`,{cache:'no-cache'}).then(response=>response.json());
      translations=locale.translations||{};
      templates=Object.entries(translations).filter(([key])=>key.includes('{{')).map(([key,value])=>{
        const names=[];const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\{\\\{(\w+)\\\}\\\}/g,(_,name)=>{names.push(name);return '(.+?)'});
        return{pattern:new RegExp(`^${escaped}$`),names,value};
      });
      document.documentElement.lang=language;
      translateElement(document.body);
      addLanguageControl(locales);
      new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
        if(node.nodeType===1||node.nodeType===3)translateElement(node.nodeType===3?node.parentElement:node);
      }))).observe(document.body,{childList:true,subtree:true});
      window.dispatchEvent(new CustomEvent('netrelay:language-ready',{detail:{language}}));
    }catch(error){console.error('[i18n]',error)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
  window.netrelayLanguage=()=>language;
  window.netrelayTranslate=value=>translated(value);
})();
