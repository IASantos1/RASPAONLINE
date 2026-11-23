const API = "";
const TOKEN_KEY = "raspaonline_demo_token";
let token = localStorage.getItem(TOKEN_KEY);
let currentTicketId = null;
let allIssues = [];
const $ = (id) => document.getElementById(id);
const money = (cents) => new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format((Number(cents)||0)/100);
const modelNames = {sorte:"Raspadinha da Sorte",cofre:"Cofre Cheio",semana:"Raspadinha da Semana",fortuna:"Magia de Natal"};
const symbols = {trevo:"☘️",estrela:"⭐",ferradura:"🧲",sino:"🔔",moeda:"🪙",diamante:"💎",coroa:"👑","barra-ouro":"🟨",chave:"🗝️",cofre:"🔐","saco-ouro":"💰",rubi:"🔴",perola:"🦪"};
async function api(path, options={}) {
  const headers = {"content-type":"application/json",...(options.headers||{})};
  if(token) headers.authorization = "Bearer "+token;
  const response = await fetch(API+path,{...options,headers});
  const data = await response.json().catch(()=>({error:"Resposta inválida do servidor."}));
  if(!response.ok) throw new Error(data.error || "Não foi possível concluir o pedido.");
  return data;
}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2800)}
function showModal(id){$(id).classList.remove("hidden")}
function hideModal(id){$(id).classList.add("hidden")}
function authUI(active){$("header-wallet").classList.toggle("hidden",!active);$("login-button").classList.toggle("hidden",active);$("register-button").classList.toggle("hidden",active);$("logout-button").classList.toggle("hidden",!active);$("account").classList.toggle("hidden",!active)}
async function loadWallet(){
  if(!token){authUI(false);return}
  try{
    const wallet=await api("/api/demo/wallet");
    $("wallet-balance").textContent=money(wallet.balanceCents);
    $("header-balance").textContent=(wallet.balanceCents/100).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2});
    $("transactions-list").innerHTML=wallet.transactions.length?wallet.transactions.map(t=>{const positive=Number(t.amount_cents)>0;return '<div class="transaction"><div>'+escapeHtml(t.description)+'<small>'+new Date(t.created_at).toLocaleString("pt-PT")+'</small></div><strong class="'+(positive?'positive':'negative')+'">'+(positive?'+':'')+money(t.amount_cents)+'</strong></div>'}).join(""):'<p class="empty-state">Ainda não existem movimentos.</p>';
    authUI(true);await loadOwnedTickets();
  }catch(e){localStorage.removeItem(TOKEN_KEY);token=null;authUI(false);toast("Sessão demo expirada. Cria uma nova conta.")}
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function loadOwnedTickets(){
  // A lista de bilhetes é mantida no dispositivo nesta versão inicial.
  const ids=JSON.parse(localStorage.getItem("raspaonline_demo_tickets")||"[]");
  const list=$("tickets-list");
  if(!ids.length){list.innerHTML='<p class="empty-state">Ainda não compraste bilhetes.</p>';return}
  list.innerHTML=ids.map(t=>'<div class="owned-ticket"><strong>'+escapeHtml(modelNames[t.model]||t.model)+'</strong><small>'+escapeHtml(t.ticketId)+'</small><button class="text-button" data-reveal="'+escapeHtml(t.ticketId)+'">'+(t.revealed?"Ver resultado":"Raspar bilhete")+' ↗</button></div>').join("");
  list.querySelectorAll("[data-reveal]").forEach(b=>b.addEventListener("click",()=>openReveal(b.dataset.reveal)));
}
async function loadIssues(){
  try{const result=await api("/api/demo/issues?limit=100");allIssues=result.issues||[]}
  catch(e){allIssues=[]}
}
function openIssues(model){
  const christmas=model==="natal";const selected=christmas?"fortuna":model;
  $("issue-title").textContent=christmas?"Magia de Natal — escolhe a tua edição":"Escolhe "+(modelNames[model]||"raspadinha");
  const issues=allIssues.filter(i=>i.model===selected);
  const list=$("issues-list");
  if(!issues.length){list.innerHTML='<div class="issue-item"><strong>Em breve</strong><small>Esta raspadinha ainda não tem emissões demo disponíveis. A emissão terá de ser criada no painel de administração.</small></div>'}
  else list.innerHTML=issues.map(i=>'<div class="issue-item"><strong>'+(christmas?"🎄 Magia de Natal":escapeHtml(modelNames[i.model]||i.model))+'</strong><small>Preço €'+Number(i.price_eur).toFixed(2).replace(".",",")+' · 1.000 bilhetes · RTP teórico 40%</small><button class="button button-primary" data-buy="'+escapeHtml(i.id)+'">Comprar por '+money(Math.round(Number(i.price_eur)*100))+'</button></div>').join("");
  list.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buyTicket(b.dataset.buy)));
  $("issue-panel").classList.remove("hidden");$("issue-panel").scrollIntoView({behavior:"smooth",block:"center"});
}
async function buyTicket(issueId){
  if(!token){showModal("auth-modal");return}
  try{
    const result=await api("/api/demo/wallet/purchase",{method:"POST",body:JSON.stringify({issueId})});
    const ids=JSON.parse(localStorage.getItem("raspaonline_demo_tickets")||"[]");
    ids.unshift({ticketId:result.ticketId,model:result.model,revealed:false});
    localStorage.setItem("raspaonline_demo_tickets",JSON.stringify(ids));
    await loadWallet();hideModal("auth-modal");toast("Bilhete demo comprado com sucesso.");await openReveal(result.ticketId);
  }catch(e){toast(e.message)}
}
async function openReveal(ticketId){
  if(!token)return;
  try{
    const status=await api("/api/demo/tickets/"+encodeURIComponent(ticketId));
    currentTicketId=ticketId;$("scratch-title").textContent=modelNames[status.model]||"A tua raspadinha";
    $("scratch-grid").innerHTML='<div class="scratch-cell">?</div>'.repeat(9);
    $("scratch-cover").classList.remove("revealed");$("scratch-result").textContent="O resultado está escondido. Toca no bilhete para revelar.";
    $("reveal-button").disabled=false;$("reveal-button").textContent=status.revealed?"Ver resultado":"Raspar agora";
    showModal("scratch-modal");
    if(status.revealed) await revealCurrent();
  }catch(e){toast(e.message)}
}
async function revealCurrent(){
  if(!currentTicketId)return;
  try{
    const result=await api("/api/demo/tickets/"+encodeURIComponent(currentTicketId)+"/reveal",{method:"POST",body:"{}"});
    const flat=(result.grid||[]).flat();
    $("scratch-grid").style.gridTemplateColumns="repeat("+((result.grid&&result.grid[0])?result.grid[0].length:3)+",1fr)";
    $("scratch-grid").innerHTML=flat.map(cell=>'<div class="scratch-cell">'+(symbols[cell]||"✦")+'</div>').join("");
    $("scratch-cover").classList.add("revealed");
    $("scratch-result").textContent=result.prizeCents>0?"✨ Parabéns! Prémio demo: "+money(result.prizeCents):"Obrigado por experimentares! Este bilhete não tem prémio demo.";
    $("reveal-button").disabled=true;$("reveal-button").textContent="Bilhete revelado";
    const ids=JSON.parse(localStorage.getItem("raspaonline_demo_tickets")||"[]").map(t=>t.ticketId===currentTicketId?{...t,revealed:true}:t);
    localStorage.setItem("raspaonline_demo_tickets",JSON.stringify(ids));
    await loadWallet();
  }catch(e){toast(e.message)}
}
$("scratch-cover").addEventListener("click",revealCurrent);
$("reveal-button").addEventListener("click",revealCurrent);
$("register-button").addEventListener("click",()=>{ $("auth-title").textContent="Criar conta demo";$("auth-description").textContent="Recebe €50 de saldo fictício para explorar a experiência.";showModal("auth-modal")});
$("login-button").addEventListener("click",()=>{ $("auth-title").textContent="Aceder à conta demo";$("auth-description").textContent="Introduz o token de acesso de 64 caracteres que guardaste ao criar a conta.";$("display-name").placeholder="Token de acesso";showModal("auth-modal")});
$("logout-button").addEventListener("click",()=>{localStorage.removeItem(TOKEN_KEY);token=null;authUI(false);toast("Sessão terminada.")});
$("auth-form").addEventListener("submit",async e=>{e.preventDefault();const value=$("display-name").value.trim();try{if(/^[a-f0-9]{64}$/.test(value)){token=value;localStorage.setItem(TOKEN_KEY,token);await loadWallet();if(!token)throw new Error("Token inválido ou conta não encontrada.");hideModal("auth-modal");toast("Sessão iniciada.");}else{const result=await api("/api/demo/wallet/accounts",{method:"POST",body:JSON.stringify({displayName:value||"Jogador Demo"})});token=result.accessToken;localStorage.setItem(TOKEN_KEY,token);hideModal("auth-modal");await loadWallet();toast("Conta demo criada. Tens €50 fictícios.");}$("display-name").value="";}catch(err){toast(err.message)}});
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>hideModal(b.dataset.close==="auth"?"auth-modal":"scratch-modal")));
document.querySelectorAll("[data-model]").forEach(b=>b.addEventListener("click",()=>openIssues(b.dataset.model)));

const menuToggle=$("mobile-menu-toggle"),mobileDrawer=$("mobile-drawer");
menuToggle.addEventListener("click",()=>{const open=mobileDrawer.classList.toggle("open");menuToggle.setAttribute("aria-expanded",String(open));menuToggle.textContent=open?"×":"☰"});
mobileDrawer.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{mobileDrawer.classList.remove("open");menuToggle.setAttribute("aria-expanded","false");menuToggle.textContent="☰"}));
document.querySelectorAll(".mobile-bottom-nav a").forEach(link=>link.addEventListener("click",(event)=>{if(link.getAttribute("href")==="#account"&&!token){event.preventDefault();showModal("auth-modal");return}document.querySelectorAll(".mobile-bottom-nav a").forEach(a=>a.classList.toggle("active",a===link))}));
document.querySelectorAll(".desktop-nav a").forEach(link=>link.addEventListener("click",()=>{document.querySelectorAll(".desktop-nav a").forEach(a=>a.classList.toggle("active",a===link))}));
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  const filter=button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item=>item.classList.toggle("active",item===button));
  document.querySelectorAll(".game-card").forEach(card=>{card.classList.toggle("hidden",filter!=="all"&&card.dataset.category!==filter)});
}));
const sidebarAccount=$("sidebar-account");if(sidebarAccount)sidebarAccount.addEventListener("click",()=>{if(token){$("account").scrollIntoView({behavior:"smooth"});}else{$("register-button").click();}});
$("christmas-play").addEventListener("click",()=>openIssues("natal"));
$("close-issues").addEventListener("click",()=>$("issue-panel").classList.add("hidden"));
loadIssues();loadWallet();