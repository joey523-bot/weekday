export function chooseLogout(root=document.body){
 return new Promise(resolve=>{
 const d=document.createElement('dialog');d.style.cssText='max-width:420px;width:calc(100% - 32px);border:0;border-radius:16px;padding:24px';
 d.innerHTML='<h2>退出登录？</h2><p>退出后将停止此设备的账号提醒。云端数据会保留。</p><label style="display:flex;gap:8px;align-items:start;margin:20px 0"><input type="checkbox" data-clear><span>同时清除此设备数据<br><small>不勾选则保留本地缓存，退出后不会展示。</small></span></label><p role="status" aria-live="polite"></p><div style="display:flex;gap:12px"><button type="button" class="button button--secondary" data-cancel>取消</button><button type="button" class="button button--danger" data-confirm>退出登录</button></div>';
 let result=null;
 d.querySelector('[data-cancel]').onclick=()=>d.close();
 d.querySelector('[data-confirm]').onclick=()=>{result={clearDeviceData:d.querySelector('[data-clear]').checked};d.close();};
 d.onclose=()=>{d.remove();resolve(result);};root.append(d);d.showModal();
 });
}
export function retainedAccountMatches(storage,phone){return storage.getItem('weekday-retained-account')===phone;}
