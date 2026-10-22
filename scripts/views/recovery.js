import { setupAdminAccess } from "./admin-access.js";
async function api(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error||'操作失败，请重试');return data;
}
export function setupRecovery(root){
 setupAdminAccess(root);
 function dialog(title){
  const d=document.createElement('dialog');d.style.cssText='max-width:440px;width:calc(100% - 32px);max-height:85vh;overflow:auto;border:0;border-radius:16px;padding:24px';
  const h=document.createElement('h2');h.textContent=title;d.append(h);
  const close=document.createElement('button');close.type='button';close.textContent='关闭';close.className='button button--secondary';close.onclick=()=>d.close();d.append(close);
  const content=document.createElement('div');d.append(content);root.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return {d,content};
 }
 const open=root.querySelector('[data-open-recovery]');
 if(open)open.onclick=()=>{
  const {content}=dialog('找回密码');
  content.innerHTML=`<form class="stack-form"><label class="field">手机号<input name="phone" class="input" type="tel" autocomplete="tel" required pattern="1[3-9][0-9]{9}" maxlength="11"></label><button class="button" type="button" data-request>提交找回申请</button><p>提交后，请通过已有联系方式联系管理员。管理员核实身份并发放恢复码后，15分钟内完成重设。</p><label class="field">恢复码<input class="input" name="code" autocomplete="off" maxlength="32"></label><label class="field">新密码<input class="input" name="password" type="password" autocomplete="new-password" maxlength="200"></label><label class="field">确认新密码<input class="input" name="confirm" type="password" autocomplete="new-password" maxlength="200"></label><button class="button" type="submit">重设密码</button><p role="status" aria-live="polite"></p></form>`;
  const form=content.querySelector('form'),status=content.querySelector('[role=status]');
  async function run(action){
   if(!form.elements.phone.reportValidity())return;
   if(action==='reset'&&(!form.elements.password.value||form.elements.password.value!==form.elements.confirm.value)){status.textContent='请填写新密码，并确保两次输入一致';return;}
   const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
   try{const r=await api('/api/auth/recovery',{action,phone:form.elements.phone.value,code:form.elements.code.value.trim(),password:form.elements.password.value});status.textContent=r.message;if(action==='reset'){form.elements.code.value='';form.elements.password.value='';form.elements.confirm.value='';}}
   catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
  }
  form.querySelector('[data-request]').onclick=()=>run('request');form.onsubmit=e=>{e.preventDefault();run('reset');};
 };
 const entry=root.querySelector('[data-recovery-admin]');
 if(entry){
  api('/api/admin/recovery').then(()=>{if(entry.isConnected)entry.hidden=false;}).catch(()=>{});
  entry.onclick=async()=>{
   const {content}=dialog('密码找回管理');content.textContent='正在读取申请…';
   try{const data=await api('/api/admin/recovery');content.textContent='仅向已通过原有联系渠道核实身份的本人发放。重复查看不会延长有效期。';
    if(!data.requests.length)content.append(document.createTextNode(' 暂无待处理申请。'));
    for(const r of data.requests){
     const section=document.createElement('section'),p=document.createElement('p');p.textContent=`${r.phone} · ${new Date(r.created_at).toLocaleString()}${r.expires_at?' · 已发放':''}`;section.append(p);
     const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('我已通过已有联系方式核实本人身份'));section.append(label);
     const button=document.createElement('button');button.type='button';button.className='button';button.textContent=r.issued_at?'查看已发放恢复码':'确认并发放';button.disabled=true;check.onchange=()=>button.disabled=!check.checked;section.append(button);
     const output=document.createElement('p');output.setAttribute('role','status');section.append(output);
     button.onclick=async()=>{button.disabled=true;try{const v=await api('/api/admin/recovery',{id:r.id,confirmed:check.checked});output.textContent=`恢复码：${v.code}（截止 ${new Date(v.expiresAt).toLocaleTimeString()}，选中复制给本人）`;output.style.overflowWrap='anywhere';button.textContent='查看已发放恢复码';}catch(e){output.textContent=e.message;}finally{button.disabled=!check.checked;}};
     content.append(section);
    }
   }catch(e){content.textContent=e.message;}
  };
 }
}
