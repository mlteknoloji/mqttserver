(() => {
  const NativeWebSocket=window.WebSocket;
  window.WebSocket=class NetRelayWebSocket extends NativeWebSocket {
    #state=null; #messageHandler=null;
    set onmessage(handler){this.#messageHandler=handler;super.onmessage=event=>{let message;try{message=JSON.parse(event.data)}catch{return handler.call(this,event)}if(message.type==='state')this.#state=message;else if(message.type==='stateDelta'&&this.#state){this.#state={...this.#state,...message.changes,type:'state'};message=this.#state;}handler.call(this,new MessageEvent('message',{data:JSON.stringify(message),origin:event.origin,lastEventId:event.lastEventId}));};}
    get onmessage(){return this.#messageHandler;}
  };
})();
