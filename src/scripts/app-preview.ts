import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/app-preview.css';

type Place = { id:string; name:string; local?:string; lat:number; lon:number; kind:string; address?:string };
type Config = { tiles:string; search:string; nearby:string };
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const frame = $('app-frame');
const preview = $('app-preview');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const tokyo: L.LatLngTuple = [35.6938,139.7034];
let map:L.Map;
let config:Config;
let places:Place[] = [];
let chosen:Place | null = null;
let searchMode = false;
let pickedIds = new Set<string>();
let markers = L.layerGroup();
let watch:number | null = null;
let userDot:L.CircleMarker | undefined;
let accuracyCircle:L.Circle | undefined;
let activeTab = 'map';
let generation = 0;
let controller:AbortController | null = null;
let lastSearch = 0;
let lastNearby = 0;
let expanded = false;
let returnFocus:HTMLElement | null = null;
let showReturnFocus:HTMLElement | null = null;
let panelSize = 0;
const searchCache = new Map<string, Place[]>();
const nearbyCache = new Map<string, Place[]>();
const status = (text:string) => { $('map-feedback').textContent = text; };
const time = (zone?:string) => new Intl.DateTimeFormat('en',{hour:'numeric',minute:'2-digit',...(zone?{timeZone:zone}:{})}).format(new Date());
function updateClock() {
  $('device-clock').textContent = time();
  if (map && !chosen && !searchMode && map.getCenter().distanceTo(tokyo)<10000) $('map-subtitle').textContent = `Tokyo · ${time('Asia/Tokyo')}`;
}
updateClock();
setInterval(updateClock,60000);

function setTab(name:string, focus=false) {
  activeTab = name;
  if(name!=='translate'&&sampleTimer){clearInterval(sampleTimer);sampleTimer=undefined;$('translate-status').textContent='Sample paused';$('play-conversation').setAttribute('aria-label','Play sample conversation');}
  document.querySelectorAll<HTMLElement>('.app-pane').forEach(el=>el.hidden=el.id!==`app-${name}`);
  document.querySelectorAll<HTMLButtonElement>('.app-tabbar button').forEach(el=>{const selected=el.dataset.appTab===name;el.setAttribute('aria-selected',String(selected));el.tabIndex=selected?0:-1;if(selected&&focus)el.focus();});
  if(name==='map') requestAnimationFrame(()=>map?.invalidateSize());
}
document.querySelectorAll<HTMLElement>('[data-app-tab]').forEach(el=>el.addEventListener('click',()=>setTab(el.dataset.appTab!)));
const tabButtons=[...document.querySelectorAll<HTMLButtonElement>('.app-tabbar button')];
tabButtons.forEach((button,i)=>button.addEventListener('keydown',event=>{let n:number|undefined;if(event.key==='ArrowRight')n=(i+1)%5;if(event.key==='ArrowLeft')n=(i+4)%5;if(event.key==='Home')n=0;if(event.key==='End')n=4;if(n!==undefined){event.preventDefault();setTab(tabButtons[n].dataset.appTab!,true);}}));

function expand(open:boolean) {
  expanded=open;
  preview.classList.toggle('is-expanded',open);
  $('close-app').hidden=!open;
  document.body.classList.toggle('app-expanded',open);
  if(open){returnFocus=document.activeElement as HTMLElement;frame.setAttribute('role','dialog');frame.setAttribute('aria-modal','true');frame.setAttribute('aria-label','Ryoko interactive preview');$('close-app').focus();}
  else{frame.removeAttribute('role');frame.removeAttribute('aria-modal');frame.removeAttribute('aria-label');returnFocus?.focus();}
  requestAnimationFrame(()=>map?.invalidateSize());
}
$('expand-app').addEventListener('click',()=>expand(true));
$('close-app').addEventListener('click',()=>expand(false));
document.querySelectorAll('[data-open-app]').forEach(el=>el.addEventListener('click',()=>{setTab('map');expand(true);}));
document.querySelectorAll<HTMLElement>('[data-feature-tab]').forEach(el=>el.addEventListener('click',()=>{setTab(el.dataset.featureTab!);expand(true);}));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape') {if(!$('app-show').hidden)closeShow();else if(expanded)expand(false);else if(!$('map-layers').hidden)toggleLayers(false);}
  if(event.key==='Tab'&&(expanded||!$('app-show').hidden)){
    const scope=$('app-show').hidden?frame:$('app-show');
    const focusables=[...scope.querySelectorAll<HTMLElement>('button,input,select,a[href],[tabindex="0"]')].filter(el=>!el.closest('[hidden]')&&!el.hasAttribute('disabled')&&el.getClientRects().length);
    const first=focusables[0],last=focusables.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});

function setPanel(size:number) {panelSize=Math.max(0,Math.min(size,2));$('map-sheet').dataset.size=['small','medium','large'][panelSize];$('sheet-handle').setAttribute('aria-expanded',String(panelSize>0));$('sheet-handle').setAttribute('aria-label',panelSize===2?'Collapse places panel':'Expand places panel');}
$('sheet-handle').addEventListener('click',()=>setPanel((panelSize+1)%3));
let grabY:number|null=null;
$('sheet-handle').addEventListener('pointerdown',e=>{grabY=e.clientY;$('sheet-handle').setPointerCapture(e.pointerId);});
$('sheet-handle').addEventListener('pointerup',e=>{if(grabY!==null&&Math.abs(e.clientY-grabY)>30){setPanel(panelSize+(e.clientY<grabY?1:-1));e.preventDefault();}grabY=null;});
function toggleLayers(open:boolean) {$('map-layers').hidden=!open;$('toggle-layers').setAttribute('aria-expanded',String(open));}
$('toggle-layers').addEventListener('click',()=>toggleLayers($('map-layers').hidden));
$('map-layers').querySelectorAll('input').forEach(el=>el.addEventListener('change',renderPlaces));
function category(kind:string){return /toilets/.test(kind)?'washroom':/cafe|restaurant|bar|food|bakery|pub/.test(kind)?'food':'sight';}
function allowed(place:Place) {const layer=pickedIds.has(place.id)?'mimo':category(place.kind);return !!$('map-layers').querySelector<HTMLInputElement>(`input[value="${layer}"]`)?.checked;}
function kindLabel(kind:string){return kind.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
function placeRow(place:Place){
  const button=element('button',undefined,'live-place-row');
  const icon=element('span',pickedIds.has(place.id)?'●':category(place.kind)==='food'?'◉':category(place.kind)==='washroom'?'WC':'◇','place-kind-icon');
  const label=element('span');label.append(element('strong',place.name));
  const distance=map.getCenter().distanceTo([place.lat,place.lon]);
  label.append(element('small',`${kindLabel(place.kind)} · ${distance<1000?`${Math.round(distance/10)*10} m`:`${(distance/1000).toFixed(1)} km`} from map center`));
  button.append(icon,label,element('span','ⓘ','place-info'));
  button.addEventListener('click',()=>openPlace(place));
  return button;
}
function renderPlaces(){
  if(!map)return;
  markers.clearLayers();const list=$('map-list');list.replaceChildren();
  const visible=places.filter(allowed).sort((a,b)=>map.getCenter().distanceTo([a.lat,a.lon])-map.getCenter().distanceTo([b.lat,b.lon]));
  const picks=visible.filter(p=>pickedIds.has(p.id)),nearby=visible.filter(p=>!pickedIds.has(p.id));
  if(picks.length){list.append(element('h4','From Mimo · sample picks'));picks.forEach(p=>list.append(placeRow(p)));}
  if(nearby.length){list.append(element('h4','Places on the map'));nearby.forEach(p=>list.append(placeRow(p)));}
  if(!visible.length)list.append(element('p',places.length?'No places match these layers.':'Search this area or search for a place.','empty-places'));
  visible.forEach(place=>{
    const pin=L.divIcon({className:'ryoko-pin',html:`<span class="pin-${category(place.kind)}${pickedIds.has(place.id)?' pin-mimo':''}">${pickedIds.has(place.id)?'●':category(place.kind)==='food'?'◉':category(place.kind)==='washroom'?'WC':'◇'}</span>`,iconSize:[32,38],iconAnchor:[16,36]});
    const marker=L.marker([place.lat,place.lon],{icon:pin,title:place.name,alt:place.name}).addTo(markers).on('click',()=>openPlace(place));
    marker.getElement()?.setAttribute('aria-label',place.name);
  });
}
function openPlace(place:Place){
  chosen=place;
  map.setView([place.lat,place.lon],Math.max(map.getZoom(),16),{animate:!reduced.matches});
  $('map-heading').textContent=place.name;$('map-subtitle').textContent=kindLabel(place.kind);setPanel(1);
  const list=$('map-list');list.replaceChildren();
  const back=element('button','Back to places','native-link');back.addEventListener('click',()=>{chosen=null;$('map-heading').textContent='Explore this area';renderPlaces();setPanel(0);});
  list.append(back,element('p',place.local||place.address||`${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`,'place-address'));
  const actions=element('div',undefined,'place-detail-actions');
  const nearby=element('button','Preview in Nearby','native-primary');nearby.addEventListener('click',()=>{setNearby(place);setTab('nearby');});
  const ask=element('button','Ask Mimo','native-secondary');ask.addEventListener('click',()=>{setTab('mimo');reply('places');});
  const directions=element('a','Open directions','native-secondary');directions.href=`https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;directions.target='_blank';directions.rel='noopener noreferrer';
  actions.append(nearby,ask,directions);list.append(actions,element('p','Place data from OpenStreetMap. The Nearby and Mimo tabs demonstrate the iPhone flow.','native-disclaimer'));
  status('Selected on the map');
}

async function request(url:string,signal:AbortSignal,init?:RequestInit){const res=await fetch(url,{...init,signal});if(!res.ok)throw new Error(`Service returned ${res.status}`);return res.json();}
async function loadNearby(){
  if(!map||!config)return;
  const center=map.getCenter();const key=`${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const cached=nearbyCache.get(key);
  if(!cached&&Date.now()-lastNearby<10000){status('Please wait a few seconds before searching another area.');return;}
  controller?.abort();controller=new AbortController();const signal=controller.signal;const current=++generation;
  const button=$<HTMLButtonElement>('search-area');button.disabled=true;status('Finding places within 700 m…');$('map-list').replaceChildren();setPanel(0);
  const timeout=setTimeout(()=>controller?.signal===signal&&controller.abort(),20000);
  try{
    let found=cached;
    if(!found){
      lastNearby=Date.now();
      const query=`[out:json][timeout:15];(nwr(around:700,${center.lat.toFixed(5)},${center.lng.toFixed(5)})[amenity~"^(cafe|restaurant|bar|pub|fast_food|toilets)$"];nwr(around:700,${center.lat.toFixed(5)},${center.lng.toFixed(5)})[tourism~"^(attraction|museum)$"];nwr(around:700,${center.lat.toFixed(5)},${center.lng.toFixed(5)})[leisure=park];);out center 45;`;
      const data=await request(config.nearby,signal,{method:'POST',body:new URLSearchParams({data:query})});
      found=(data.elements||[]).map((item:any)=>({id:`${item.type}/${item.id}`,name:item.tags?.['name:en']||item.tags?.name||(item.tags?.amenity==='toilets'?'Public washroom':null),local:item.tags?.name,lat:item.lat??item.center?.lat,lon:item.lon??item.center?.lon,kind:item.tags?.amenity||item.tags?.tourism||item.tags?.leisure||'place',address:[item.tags?.['addr:street'],item.tags?.['addr:housenumber']].filter(Boolean).join(' ')})).filter((p:Place)=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
      nearbyCache.set(key,found!);
    }
    if(current!==generation)return;
    places=found!;pickedIds.clear();chosen=null;searchMode=false;renderPlaces();$('map-heading').textContent='Near this map area';$('map-subtitle').textContent=center.distanceTo(tokyo)<10000?`Tokyo · ${time('Asia/Tokyo')}`:'Live place data';
    status(`${places.length} places · ${cached?'loaded from this session':'updated '+time()}`);
  }catch(error){if(current===generation){status(navigator.onLine?'Place search is unavailable. Try again, or search by name.':'You’re offline. Reconnect to load places.');renderPlaces();}}
  finally{clearTimeout(timeout);if(current===generation)button.disabled=false;}
}
$('search-area').addEventListener('click',loadNearby);
$('map-search').addEventListener('submit',async event=>{
  event.preventDefault();const query=$<HTMLInputElement>('place-search').value.trim();if(!query||!config)return;
  if(Date.now()-lastSearch<1200){status('Wait a moment before searching again.');return;}lastSearch=Date.now();
  controller?.abort();controller=new AbortController();const signal=controller.signal;const current=++generation;
  $<HTMLButtonElement>('search-area').disabled=false;
  const timeout=setTimeout(()=>controller?.signal===signal&&controller.abort(),15000);
  status(`Searching for ${query}…`);setPanel(1);
  try{
    let found=searchCache.get(query.toLowerCase());
    if(!found){const url=new URL(config.search);url.search=new URLSearchParams({q:query,limit:'8',lang:'en'}).toString();const data=await request(url.toString(),signal);
      found=(data.features||[]).map((f:any)=>({id:`${f.properties.osm_type}/${f.properties.osm_id}`,name:f.properties.name||f.properties.street||query,lat:f.geometry?.coordinates?.[1],lon:f.geometry?.coordinates?.[0],kind:f.properties.osm_value||'place',address:[f.properties.street,f.properties.city,f.properties.country].filter(Boolean).join(', ')})).filter((p:Place)=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));searchCache.set(query.toLowerCase(),found!);}
    if(current!==generation)return;
    places=found!;pickedIds.clear();chosen=null;searchMode=true;
    $('map-heading').textContent='Search results';$('map-subtitle').textContent=query;
    if(places.length)map.setView([places[0].lat,places[0].lon],15,{animate:!reduced.matches});
    // A searched place must remain visible regardless of the previous category filter.
    $('map-layers').querySelectorAll<HTMLInputElement>('input').forEach(el=>el.checked=true);
    renderPlaces();status(places.length?`${places.length} results · OpenStreetMap via Photon`:'No results. Try a place name and city.');
    $<HTMLInputElement>('place-search').blur();
  }catch(error){if(current===generation)status('Search is unavailable. Please try again.');}
  finally{clearTimeout(timeout);}
});
function stopFollowing(){if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;$('locate-me').setAttribute('aria-pressed','false');$('locate-me').setAttribute('aria-label','Follow my location');}
$('locate-me').addEventListener('click',()=>{
  if(watch!==null){stopFollowing();status('Location following stopped.');return;}
  if(!navigator.geolocation){status('Location is unavailable in this browser. Search a city instead.');return;}
  status('Waiting for location permission…');
  $('locate-me').setAttribute('aria-pressed','true');$('locate-me').setAttribute('aria-label','Stop following my location');
  watch=navigator.geolocation.watchPosition(position=>{
    const point:L.LatLngTuple=[position.coords.latitude,position.coords.longitude];
    if(!userDot){userDot=L.circleMarker(point,{radius:7,fillColor:'#3077df',color:'#fff',weight:3,fillOpacity:1}).addTo(map);accuracyCircle=L.circle(point,{radius:position.coords.accuracy,color:'#3077df',weight:1,fillOpacity:.08}).addTo(map);}else{userDot.setLatLng(point);accuracyCircle?.setLatLng(point).setRadius(position.coords.accuracy);}
    map.setView(point,Math.max(map.getZoom(),16),{animate:!reduced.matches});$('map-heading').textContent='Near you';$('map-subtitle').textContent='Location updates are on';status('Following your location. Tap Search this area for nearby places.');
  },error=>{stopFollowing();status(error.code===1?'Location is off. You can still search any place.':'Could not find your location. Try again outdoors or search a place.');},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&watch!==null){stopFollowing();status('Location following paused while the page is hidden.');}});
window.addEventListener('pagehide',stopFollowing);
$('map-home').addEventListener('click',()=>{searchMode=false;chosen=null;stopFollowing();controller?.abort();generation++;map?.setView(tokyo,16);$<HTMLInputElement>('place-search').value='';$('map-heading').textContent='Explore Shinjuku';$('map-subtitle').textContent=`Tokyo · ${time('Asia/Tokyo')}`;loadNearby();});
$('zoom-in').addEventListener('click',()=>map?.zoomIn());$('zoom-out').addEventListener('click',()=>map?.zoomOut());

function setNearby(place:Place){
  $('nearby-place').textContent=place.name;
  const japan=place.lat>24&&place.lat<46&&place.lon>123&&place.lon<146;
  const china=place.lat>18&&place.lat<54&&place.lon>73&&place.lon<123;
  const food=category(place.kind)==='food';
  $('nearby-context').textContent='Selected on Map · curated example phrase';
  const phrase=japan?(food?['一番人気はどれですか？','Ichiban ninki wa dore desu ka?','Which one is the most popular?']:['入口はどこですか？','Iriguchi wa doko desu ka?','Where is the entrance?']):china?(food?['少糖，去冰','Shǎo táng, qù bīng','Less sugar, no ice.']:['入口在哪里？','Rùkǒu zài nǎlǐ?','Where is the entrance?']):['Where is the entrance?','','English example · local translations run in the iPhone app.'];
  $('native-phrase').textContent=phrase[0];$('native-phrase').lang=japan?'ja':china?'zh-Hans':'en';$('native-romanization').textContent=phrase[1];$('native-gloss').textContent=phrase[2];
  document.querySelector<HTMLElement>('.native-because')!.textContent='An example of the words you might need here.';
  $('native-tip').textContent='Open Show for a larger card, or change the preview time above.';
}

$<HTMLSelectElement>('preview-time').addEventListener('change',e=>{const hour=Number((e.target as HTMLSelectElement).value);frame.dataset.period=hour<11?'morning':hour<16?'midday':hour<20?'evening':'night';$('preview-time-label').textContent=`${hour%12||12}:00 ${hour<12?'AM':'PM'}`;});
$<HTMLInputElement>('romanization').addEventListener('change',event=>$('native-romanization').hidden=!(event.target as HTMLInputElement).checked);
$<HTMLInputElement>('less-sweet').addEventListener('change',event=>{const less=(event.target as HTMLInputElement).checked;if($('native-phrase').lang!=='zh-Hans')return;$('native-phrase').textContent=less?'少糖，去冰':'正常糖，去冰';$('native-romanization').textContent=less?'Shǎo táng, qù bīng':'Zhèngcháng táng, qù bīng';$('native-gloss').textContent=less?'Less sugar, no ice.':'Regular sugar, no ice.';document.querySelector<HTMLElement>('.native-because')!.textContent=less?'Because you like it less sweet.':'Because you prefer regular sweetness.';});
function showPhrase(local:string,gloss:string,lang='zh-Hans'){
  showReturnFocus=document.activeElement as HTMLElement;$('show-local').textContent=local;$('show-local').lang=lang;$('show-gloss').textContent=gloss;$('app-show').hidden=false;$('show-words').classList.remove('flipped');$('flip-show').setAttribute('aria-pressed','false');$('done-show').focus();
  frame.querySelectorAll<HTMLElement>('.app-pane,.app-tabbar').forEach(el=>el.inert=true);
}
function closeShow(){$('app-show').hidden=true;frame.querySelectorAll<HTMLElement>('.app-pane,.app-tabbar').forEach(el=>el.inert=false);showReturnFocus?.focus();}
$('done-show').addEventListener('click',closeShow);
$('flip-show').addEventListener('click',()=>{const flipped=$('show-words').classList.toggle('flipped');$('flip-show').setAttribute('aria-pressed',String(flipped));});
document.querySelectorAll('[data-show-phrase]').forEach(el=>el.addEventListener('click',()=>showPhrase($('native-phrase').textContent!,$('native-gloss').textContent!,$('native-phrase').lang)));
$('taxi-card').addEventListener('click',()=>{
  if(chosen)showPhrase(chosen.local||chosen.name,`${chosen.address||''}\n${chosen.lat.toFixed(5)}, ${chosen.lon.toFixed(5)}`,'und');
  else showPhrase('请带我去这里。','Please take me here. Select a destination on Map first.');
});
$('face-to-face').addEventListener('click',()=>{const flipped=$('translation-halves').classList.toggle('face-to-face');$('face-to-face').setAttribute('aria-pressed',String(flipped));});
let sampleTimer:ReturnType<typeof setInterval>|undefined;
let sampleIndex=0;
const turns=[['需要袋子吗？','Would you like a bag?'],['不用，谢谢。','No, thank you.'],['少糖，去冰。','Less sugar, no ice.']];
$('play-conversation').addEventListener('click',()=>{
  if(sampleTimer){clearInterval(sampleTimer);sampleTimer=undefined;$('translate-status').textContent='Sample paused';$('play-conversation').setAttribute('aria-label','Play sample conversation');return;}
  $('translate-status').textContent='Playing sample conversation';$('play-conversation').setAttribute('aria-label','Pause sample conversation');
  const next=()=>{const turn=turns[sampleIndex++%turns.length];$('their-words').textContent=turn[0];$('your-words').textContent=turn[1];};next();sampleTimer=setInterval(next,2600);
});
function reply(kind:string){
  const output=$('mimo-reply');output.replaceChildren();
  if(kind==='order'){
    output.append(element('p','You can show this at the counter:'));
    const phrase=element('button','少冰 · Less ice','mimo-inline-phrase');phrase.lang='zh-Hans';phrase.addEventListener('click',()=>showPhrase('少冰','Less ice.'));output.append(phrase,element('p','Or use 去冰 if you’d like no ice at all.'));
  }else{
    const suggestions=places.filter(p=>p.kind!=='toilets'&&p.kind!=='fast_food').sort((a,b)=>map.getCenter().distanceTo([a.lat,a.lon])-map.getCenter().distanceTo([b.lat,b.lon])).slice(0,3);
    if(!suggestions.length){output.append(element('p','Search an area on Map first. Then I can show you how places appear in a reply.'));return;}
    output.append(element('p','Here are a few places from your current map area. This is a sample reply.'));
    const card=element('div',undefined,'native-card');suggestions.forEach(p=>{const button=element('button',p.name,'mimo-place-button');button.addEventListener('click',()=>{setTab('map');openPlace(p);});card.append(button);});
    const show=element('button','Show on map','native-primary');show.addEventListener('click',()=>{chosen=null;searchMode=true;pickedIds=new Set(suggestions.map(p=>p.id));$<HTMLInputElement>('map-layers').querySelectorAll<HTMLInputElement>('input').forEach(el=>el.checked=true);setTab('map');map.fitBounds(L.latLngBounds(suggestions.map(p=>[p.lat,p.lon] as L.LatLngTuple)),{padding:[50,90],maxZoom:16});renderPlaces();setPanel(0);$('map-heading').textContent='From Mimo';status('Sample selection · real places from your map');});card.append(show);output.append(card);
  }
}
document.querySelectorAll<HTMLElement>('[data-mimo]').forEach(el=>el.addEventListener('click',()=>reply(el.dataset.mimo!)));

async function init(){
  try{
    const response=await fetch('/map-config.json');if(!response.ok)throw new Error('Map configuration unavailable');config=await response.json();
    map=L.map('live-map',{zoomControl:false,scrollWheelZoom:false,zoomAnimation:!reduced.matches,fadeAnimation:!reduced.matches}).setView(tokyo,16);
    const tiles=L.tileLayer(config.tiles,{maxZoom:19,minZoom:3,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',keepBuffer:1}).addTo(map);
    tiles.on('tileerror',()=>status('Some map tiles could not load. Check your connection.'));
    markers.addTo(map);new ResizeObserver(()=>map.invalidateSize()).observe($('live-map'));
    map.on('dragstart',()=>{if(watch!==null){stopFollowing();status('Location following stopped while you explore.');}});
    map.on('moveend',()=>{if(!chosen&&!searchMode&&watch===null){$('map-heading').textContent='Explore this area';$('map-subtitle').textContent=map.getCenter().distanceTo(tokyo)<10000?`Tokyo · ${time('Asia/Tokyo')}`:'Search here for nearby places';}});
    map.on('contextmenu',(event:L.LeafletMouseEvent)=>{const pin:Place={id:'dropped',name:'Dropped pin',lat:event.latlng.lat,lon:event.latlng.lng,kind:'place'};places=places.filter(p=>p.id!=='dropped');places.push(pin);renderPlaces();openPlace(pin);});
    await loadNearby();
  }catch(error){status('The map could not start. Reload the page to try again.');}
}
init();
