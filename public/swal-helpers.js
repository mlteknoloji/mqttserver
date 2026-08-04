(function(){
  const themed=options=>({
    background:document.documentElement.dataset.theme==='light'?'#ffffff':'#111827',
    color:document.documentElement.dataset.theme==='light'?'#172033':'#e5e7eb',
    confirmButtonColor:'#2563eb',
    cancelButtonColor:'#64748b',
    ...options
  });

  window.netrelayConfirm=async function(message,options={}){
    const result=await Swal.fire(themed({
      icon:'warning',
      title:options.title||'İşlemi onaylayın',
      text:message,
      showCancelButton:true,
      confirmButtonText:options.confirmButtonText||'Evet, devam et',
      cancelButtonText:'Vazgeç',
      reverseButtons:true,
      focusCancel:true
    }));
    return result.isConfirmed;
  };

  window.netrelayAlert=function(message,icon='info',title){
    return Swal.fire(themed({icon,title:title||(icon==='error'?'Hata':icon==='success'?'Başarılı':'Bilgi'),text:String(message||'')}));
  };

  // Eski sayfalardaki senkron confirm çağrılarını da SweetAlert2 üzerinden
  // çalıştırır ve kullanıcı onayladığında aynı tıklama/gönderme olayını yineler.
  let eventTarget=null,bypassOnce=false,confirmOpen=false;
  document.addEventListener('click',event=>{eventTarget=event.target.closest('button,a,input')||event.target},true);
  document.addEventListener('submit',event=>{eventTarget=event.target},true);
  window.confirm=function(message){
    if(bypassOnce){bypassOnce=false;return true}
    if(confirmOpen)return false;
    const target=eventTarget;
    confirmOpen=true;
    netrelayConfirm(message).then(confirmed=>{
      confirmOpen=false;
      if(!confirmed||!target)return;
      bypassOnce=true;
      if(target instanceof HTMLFormElement)target.requestSubmit();
      else target.click();
    });
    return false;
  };
  window.alert=message=>netrelayAlert(message);
})();
