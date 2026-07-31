import{getApps,getApp}from'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import{getAuth,onAuthStateChanged}from'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import{getFirestore,doc,onSnapshot,setDoc,serverTimestamp}from'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

const app=getApps().length?getApp():null;
if(app){
  const auth=getAuth(app),db=getFirestore(app);
  let user=null,entries=[],distance=75,unsubscribe=null;
  const $=id=>document.getElementById(id);
  const journalRef=()=>doc(db,'users',user.uid,'days','_journal');
  const overlaps=(e,from,to)=>e?.from&&!(String(e.to||e.from)<from||String(e.from)>to);
  const closeSheet=()=>{const back=$('sheetback'),body=$('body');if(back)back.hidden=true;if(body)body.innerHTML=''};
  const showMessage=text=>{const toast=$('toast');if(!toast)return;toast.textContent=text;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1800)};

  async function saveVacation(){
    const from=$('periodFrom')?.value,to=$('periodTo')?.value||from,title=$('periodTitle')?.value.trim()||'',vacationDays=Number($('vacationDays')?.value);
    if(!user)return alert('Bitte zuerst anmelden.');
    if(!from)return alert('Bitte ein Startdatum angeben.');
    if(to<from)return alert('Das Bis-Datum liegt vor dem Von-Datum.');
    if(!Number.isFinite(vacationDays)||vacationDays<0)return alert('Bitte die tatsächlich benötigten Urlaubstage eintragen.');
    const existing=entries.filter(e=>overlaps(e,from,to));
    if(existing.length&&!confirm(`Im gewählten Zeitraum bestehen bereits ${existing.length} Eintrag bzw. Einträge. Urlaub trotzdem zusätzlich speichern?`))return;
    entries=[...entries,{id:Date.now(),type:'urlaub',from,to,title,note:'',vacationDays}];
    await setDoc(journalRef(),{entries,distance,updatedAt:serverTimestamp()});
    closeSheet();showMessage('Urlaub gespeichert');
  }

  function enhancePeriodForm(){
    const type=$('periodType'),save=$('periodSave');
    if(!type||!save||save.dataset.vacationEnhanced)return;
    save.dataset.vacationEnhanced='1';
    const original=save.onclick;
    const field=document.createElement('div');
    field.className='field';field.id='vacationDaysWrap';
    field.innerHTML='<label>Tatsächlich benötigte Urlaubstage</label><input id="vacationDays" type="number" min="0" step="0.5" inputmode="decimal" placeholder="z. B. 5"><small class="muted">Wochenenden und Feiertage selbst herausrechnen.</small>';
    const title=$('periodTitle')?.closest('.field');
    if(title)title.before(field);else save.before(field);
    const refresh=()=>{field.hidden=type.value!=='urlaub'};
    type.addEventListener('change',refresh);refresh();
    save.onclick=event=>{if(type.value==='urlaub'){event.preventDefault();saveVacation().catch(e=>alert('Speichern fehlgeschlagen: '+e.message));}else if(typeof original==='function')original.call(save,event)};
  }

  const observer=new MutationObserver(enhancePeriodForm);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  enhancePeriodForm();

  onAuthStateChanged(auth,u=>{
    user=u;if(unsubscribe){unsubscribe();unsubscribe=null}if(!u)return;
    unsubscribe=onSnapshot(journalRef(),snap=>{const data=snap.data()||{};entries=Array.isArray(data.entries)?data.entries:[];distance=Number(data.distance)||75});
  });
}
