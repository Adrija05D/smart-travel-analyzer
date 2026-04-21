/**
 * ============================================================
 *  SMART TRAVEL ANALYZER — script.js
 *  Two-Page SPA · Slide Transitions · Touch Ripple Effects
 *  Cyberpunk Edition · Vanilla ES6+ · async/await
 * ============================================================
 */

'use strict';

/* ──────────────────────────────────────────────────────────
   API CONFIGURATION
   ────────────────────────────────────────────────────────── */
const CONFIG = {
  OWM_KEY:    '07d92457a8022ad4a8a71939f15cf31f',
  OPENAQ_KEY: '07d92457a8022ad4a8a71939f15cf31f',
  OWM_BASE:   'https://api.openweathermap.org/data/2.5',
  OPENAQ_BASE:'https://api.openaq.org/v3',
  COUNTRIES:  'https://restcountries.com/v3.1',
};

/* ──────────────────────────────────────────────────────────
   DOM SHORTHAND + NULL-SAFE HELPERS
   ────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const setText = (id, val)       => { const el=$(id); if(el) el.textContent = val; };
const setHtml = (id, val)       => { const el=$(id); if(el) el.innerHTML   = val; };
const setCss  = (id, prop, val) => { const el=$(id); if(el) el.style[prop] = val; };

/* ──────────────────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────────────────── */
let unit            = localStorage.getItem('sta_unit') || 'celsius';
let lastWeatherData = null;
let lastAQI         = 42;
let lastQuery       = null;   // string or {lat,lon}

/* ──────────────────────────────────────────────────────────
   PAGE NAVIGATION — Slide Transitions
   ────────────────────────────────────────────────────────── */
const pageHome    = $('pageHome');
const pageResults = $('pageResults');
const curtain     = $('pageCurtain');

function goToResults() {
  // Flash curtain
  curtain.classList.add('flash');
  setTimeout(() => curtain.classList.remove('flash'), 280);

  pageHome.classList.add('exit');
  pageResults.classList.add('enter');

  // Scroll results to top
  const scroller = document.querySelector('.results-scroll');
  if (scroller) scroller.scrollTop = 0;
}

function goToHome() {
  curtain.classList.add('flash');
  setTimeout(() => curtain.classList.remove('flash'), 280);

  pageHome.classList.remove('exit');
  pageResults.classList.remove('enter');

  // Bring input back into focus
  setTimeout(() => $('cityInput')?.focus(), 400);
}

/* ──────────────────────────────────────────────────────────
   TOUCH / CLICK RIPPLE EFFECT
   Attaches to all .ripple-host elements dynamically
   ────────────────────────────────────────────────────────── */
function spawnRipple(el, e) {
  const rect  = el.getBoundingClientRect();
  const touch = e.touches?.[0] ?? e;
  const x     = (touch.clientX ?? touch.pageX) - rect.left;
  const y     = (touch.clientY ?? touch.pageY) - rect.top;
  const size  = Math.max(rect.width, rect.height) * 2;

  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.cssText = `
    width:${size}px; height:${size}px;
    left:${x - size/2}px; top:${y - size/2}px;
  `;
  el.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove(), { once: true });
}

function setupRipples() {
  // Use event delegation on document so dynamically added elements also get ripple
  const handle = e => {
    const host = e.target.closest('.ripple-host');
    if (!host) return;
    spawnRipple(host, e);
  };
  document.addEventListener('mousedown', handle, { passive: true });
  document.addEventListener('touchstart', handle, { passive: true });
}

/* ──────────────────────────────────────────────────────────
   WEATHER ICON MAP
   ────────────────────────────────────────────────────────── */
const WEATHER_ICONS = {
  'clear sky':'☀️','few clouds':'🌤️','scattered clouds':'⛅','broken clouds':'🌥️',
  'overcast clouds':'☁️','light rain':'🌦️','moderate rain':'🌧️','heavy intensity rain':'⛈️',
  'very heavy rain':'🌊','extreme rain':'🌊','freezing rain':'🌨️','light drizzle':'🌦️',
  'drizzle':'🌧️','heavy drizzle':'🌧️','light snow':'🌨️','snow':'❄️','heavy snow':'❄️',
  'sleet':'🌨️','mist':'🌫️','smoke':'🌫️','haze':'🌫️','dust':'🌫️','fog':'🌫️','sand':'🌫️',
  'ash':'🌋','squall':'🌬️','tornado':'🌪️','thunderstorm':'⛈️',
  'thunderstorm with light rain':'⛈️','thunderstorm with rain':'⛈️','thunderstorm with heavy rain':'⛈️',
};
const getWeatherEmoji = desc => WEATHER_ICONS[desc?.toLowerCase?.()] ?? '🌡️';

/* ──────────────────────────────────────────────────────────
   AQI
   ────────────────────────────────────────────────────────── */
const AQI_TABLE = [
  {max:50,  key:'good',           label:'Good',               gauge:'#00f5d4'},
  {max:100, key:'moderate',       label:'Moderate',           gauge:'#ffd60a'},
  {max:150, key:'unhealthy-sg',   label:'Unhealthy for Some', gauge:'#f97316'},
  {max:200, key:'unhealthy',      label:'Unhealthy',          gauge:'#ef4444'},
  {max:300, key:'very-unhealthy', label:'Very Unhealthy',     gauge:'#a855f7'},
  {max:Infinity,key:'hazardous',  label:'Hazardous',          gauge:'#7e22ce'},
];
const AQI_DESC = {
  'good':           'Air quality is satisfactory — minimal health risk. Perfect for outdoor activities.',
  'moderate':       'Air quality is acceptable. Sensitive individuals may notice mild irritation.',
  'unhealthy-sg':   'Sensitive groups (children, elderly, asthma) may experience health effects.',
  'unhealthy':      'Everyone may experience health effects. Limit prolonged outdoor exposure.',
  'very-unhealthy': 'Health alert: serious risk for everyone. Avoid outdoor activities.',
  'hazardous':      'Emergency conditions. Entire population is affected. Stay indoors.',
};
const getAqiLevel = aqi => AQI_TABLE.find(l => aqi <= l.max);

function pollutantBadge(val, max) {
  if (val == null) return {label:'N/A', cls:''};
  const p = val / max;
  if (p < .33) return {label:'Low',  cls:'good'};
  if (p < .66) return {label:'Med',  cls:'moderate'};
  return            {label:'High', cls:'bad'};
}

function pm25ToAQI(c) {
  const bp=[[0,12,0,50],[12.1,35.4,51,100],[35.5,55.4,101,150],[55.5,150.4,151,200],[150.5,250.4,201,300],[250.5,500.4,301,500]];
  for(const[lo,hi,ilo,ihi]of bp) if(c>=lo&&c<=hi) return Math.round(((ihi-ilo)/(hi-lo))*(c-lo)+ilo);
  return c>500?500:0;
}

/* ──────────────────────────────────────────────────────────
   UTILS
   ────────────────────────────────────────────────────────── */
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const degToDir = deg => DIRS[Math.round(deg/22.5)%16];
const toDisplayTemp = c => unit==='fahrenheit' ? (c*9/5+32) : c;
const fmtTemp  = (c,d=0) => c==null ? '—' : Number(toDisplayTemp(c)).toFixed(d);
const unitLabel = () => unit==='fahrenheit' ? '°F' : '°C';
const fmt    = (n,d=1) => n==null ? '—' : Number(n).toFixed(d);
const fmtPop = n => n ? n.toLocaleString('en-IN') : '—';
const unixToTime = ts => new Date(ts*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const capit = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : '';

/* ──────────────────────────────────────────────────────────
   RECENT SEARCHES
   ────────────────────────────────────────────────────────── */
const LS_KEY      = 'sta_recent_v1';
const LS_LAST_KEY = 'sta_last_city';

function getRecent(){try{return JSON.parse(localStorage.getItem(LS_KEY))??[];}catch{return[];}}
function addRecent(city) {
  const cap = capit(city);
  let list  = getRecent().filter(c=>c.toLowerCase()!==city.toLowerCase());
  list.unshift(cap); if(list.length>6) list=list.slice(0,6);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  localStorage.setItem(LS_LAST_KEY, cap);
  renderRecent();
}
function clearRecent(){localStorage.removeItem(LS_KEY);renderRecent();}
function renderRecent() {
  const list=getRecent(), wrap=$('recentSearches'), chips=$('recentChips');
  if(!wrap||!chips) return;
  if(!list.length){wrap.classList.remove('visible');return;}
  wrap.classList.add('visible');
  chips.innerHTML=list.map(c=>`<button class="recent-chip ripple-host" data-city="${c}">🕐 ${c}</button>`).join('');
  chips.querySelectorAll('.recent-chip').forEach(btn=>{
    btn.addEventListener('click',()=>{$('cityInput').value=btn.dataset.city;analyzeCity(btn.dataset.city);});
  });
}

/* ──────────────────────────────────────────────────────────
   LOADING / ERROR / RESULTS UI STATE
   ────────────────────────────────────────────────────────── */
const STEP_LABELS = ['🌦 Fetching weather…','🫁 Scanning air quality…','🌍 Loading country data…','📅 Grabbing 5-day forecast…'];

function showLoading(on) {
  const spinner = $('loadingSpinner');
  spinner?.classList.toggle('visible', on);
  if (on) {
    $('errorBox')?.classList.remove('visible');
    $('results')?.classList.remove('visible');
    [$('step1'),$('step2'),$('step3'),$('step4')].forEach(s=>s?.classList.remove('active'));
    $('step1')?.classList.add('active');
    setText('loaderLabel', STEP_LABELS[0]);
    goToResults();           // ← navigate immediately on search
  }
}

function setStep(n) {
  [$('step1'),$('step2'),$('step3'),$('step4')].forEach((s,i)=>s?.classList.toggle('active',i+1===n));
  setText('loaderLabel', STEP_LABELS[n-1] ?? 'Processing…');
}

function showError(msg) {
  $('errorBox').classList.add('visible');
  setText('errorMsg', msg);
}

function showResults() {
  $('loadingSpinner')?.classList.remove('visible');
  $('results')?.classList.add('visible');
}

function setBodyTheme(aqi) {
  document.body.classList.remove('aqi-safe','aqi-moderate','aqi-unhealthy');
  if (aqi<=50)       document.body.classList.add('aqi-safe');
  else if (aqi<=100) document.body.classList.add('aqi-moderate');
  else               document.body.classList.add('aqi-unhealthy');
}

/* ──────────────────────────────────────────────────────────
   FETCH HELPERS
   ────────────────────────────────────────────────────────── */
async function fetchJSON(url, headers={}) {
  const res=await fetch(url,{headers});
  if(!res.ok){const t=await res.text().catch(()=>'');throw new Error(`API ${res.status}: ${t.slice(0,120)}`);}
  return res.json();
}

async function fetchWeather(query) {
  const q=typeof query==='string'?`q=${encodeURIComponent(query)}`:`lat=${query.lat}&lon=${query.lon}`;
  return fetchJSON(`${CONFIG.OWM_BASE}/weather?${q}&appid=${CONFIG.OWM_KEY}&units=metric`);
}

async function fetchForecast(query) {
  try {
    const q=typeof query==='string'?`q=${encodeURIComponent(query)}`:`lat=${query.lat}&lon=${query.lon}`;
    return fetchJSON(`${CONFIG.OWM_BASE}/forecast?${q}&appid=${CONFIG.OWM_KEY}&units=metric&cnt=40`);
  } catch{return null;}
}

async function fetchAirQuality(lat, lon) {
  const hdrs={'X-API-Key':CONFIG.OPENAQ_KEY};
  let locData;
  try{locData=await fetchJSON(`${CONFIG.OPENAQ_BASE}/locations?coordinates=${lat},${lon}&radius=50000&limit=5&order_by=distance`,hdrs);}
  catch{return null;}
  if(!locData?.results?.length) return null;
  let sensData;
  try{sensData=await fetchJSON(`${CONFIG.OPENAQ_BASE}/locations/${locData.results[0].id}/sensors`,hdrs);}
  catch{return null;}
  const readings={};
  for(const s of(sensData?.results??[])){
    const key=s.parameter?.name?.toLowerCase().replace(/\./g,'');
    const val=s.latest?.value;
    if(key&&val!=null) readings[key]=val;
  }
  return Object.keys(readings).length?readings:null;
}

async function fetchCountry(code) {
  try{
    const d=await fetchJSON(`${CONFIG.COUNTRIES}/alpha/${code}?fields=name,capital,population,flags,region,subregion,currencies,languages`);
    return Array.isArray(d)?d[0]:d;
  }catch{return null;}
}

/* ──────────────────────────────────────────────────────────
   RENDER FUNCTIONS
   ────────────────────────────────────────────────────────── */
function renderCity(w) {
  const {name,coord,sys}=w;
  setText('cityName',  name);
  setText('cityCoord', `${coord.lat.toFixed(4)}°N  ${coord.lon.toFixed(4)}°E`);
  const now=new Date();
  setText('cityTimeText',
    now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'  ·  '+
    now.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})
  );
  if(sys?.sunrise) setText('sunriseVal', unixToTime(sys.sunrise));
  if(sys?.sunset)  setText('sunsetVal',  unixToTime(sys.sunset));
  setText('topbarCity', name);     // also update topbar
}

function renderCountry(data, code) {
  if(!data){
    ['countryFlag','countryName','countryRegion','countryCapital','countryPop','countryCurr','countryLang']
      .forEach((id,i)=>setText(id,['🌐',code,'—','—','—','—','—'][i]));
    return;
  }
  setText('countryFlag',    data.flags?.emoji??'🏳️');
  setText('countryName',    data.name?.common??code);
  setText('countryRegion',  [data.subregion,data.region].filter(Boolean).join('  ·  '));
  setText('countryCapital', data.capital?.[0]??'—');
  setText('countryPop',     fmtPop(data.population));
  if(data.currencies){
    const v=Object.values(data.currencies);
    setText('countryCurr', v.length?`${Object.keys(data.currencies)[0]} – ${v[0].name}`:'—');
  }
  if(data.languages) setText('countryLang', Object.values(data.languages).slice(0,2).join(', ')||'—');
}

function renderWeather(w) {
  const m=w.main, wind=w.wind??{}, desc=w.weather[0]?.description??'';
  setText('weatherIcon',      getWeatherEmoji(desc));
  setText('tempVal',          fmtTemp(m.temp,0));
  setText('tempUnit',         unitLabel());
  setText('feelsLike',        `Feels like ${fmtTemp(m.feels_like,0)}${unitLabel()}`);
  setText('weatherCondition', capit(desc));
  setText('tempMin',          `↓ ${fmtTemp(m.temp_min,0)}${unitLabel()}`);
  setText('tempMax',          `↑ ${fmtTemp(m.temp_max,0)}${unitLabel()}`);
  setText('humidVal',         m.humidity??'—');
  setText('humidDesc',        humidDesc(m.humidity));
  setText('visibilityVal',    w.visibility?`Visibility: ${(w.visibility/1000).toFixed(1)} km`:'Visibility: —');
  setText('cloudVal',         `Clouds: ${w.clouds?.all??'—'}%`);
  setText('windVal',          fmt(wind.speed,1));
  setText('windDir',          `Direction: ${degToDir(wind.deg??0)} (${wind.deg??'—'}°)`);
  setText('pressureVal',      `Pressure: ${m.pressure} hPa`);
  if(m.temp!=null&&m.humidity!=null)
    setText('dewPointVal',`Dew Point: ${fmtTemp(m.temp-((100-m.humidity)/5),0)}${unitLabel()}`);
}

function humidDesc(h){
  if(h==null) return '—';
  if(h<25)  return '🌵 Very dry — risk of dehydration';
  if(h<55)  return '✅ Comfortable humidity';
  if(h<75)  return '🌤 Slightly humid';
  if(h<90)  return '💦 Humid — may feel uncomfortable';
  return '🌊 Very humid — feels heavy';
}

function renderAQI(aqi, readings) {
  const lvl=getAqiLevel(aqi);
  setText('aqiNum',    aqi);
  setText('aqiStatus', lvl.label);
  setText('aqiDesc',   AQI_DESC[lvl.key]??'');
  const pct=Math.min(aqi/300,1);
  setCss('gaugeFill','strokeDashoffset', 314-pct*314);
  setCss('gaugeFill','stroke',           lvl.gauge);
  const gf=$('gaugeFill');
  if(gf) gf.style.filter=`drop-shadow(0 0 6px ${lvl.gauge})`;
  setCss('aqiScaleFill','width',(1-pct)*100+'%');

  const CHIPS=[
    {id:'pm25',keys:['pm25'],      max:150},
    {id:'pm10',keys:['pm10'],      max:250},
    {id:'no2', keys:['no2'],       max:200},
    {id:'o3',  keys:['o3','ozone'],max:180},
  ];
  for(const chip of CHIPS){
    let val=null;
    for(const k of chip.keys) if(readings?.[k]!=null){val=readings[k];break;}
    setText(chip.id+'Val', val!=null?fmt(val):'—');
    const fillEl=$(chip.id+'Bar');
    if(fillEl){
      fillEl.style.width=(val!=null?Math.min(val/chip.max*100,100):0)+'%';
      const {cls}=pollutantBadge(val,chip.max);
      fillEl.className='pol-meter-fill'+(cls?' '+cls:'');
    }
    const badgeEl=$(chip.id+'Badge');
    if(badgeEl){
      const {label:bl,cls:bc}=pollutantBadge(val,chip.max);
      badgeEl.textContent=bl; badgeEl.className=`pol-badge ${bc}`;
    }
  }
}

function renderForecast(data) {
  const strip=$('forecastStrip');
  if(!strip) return;
  if(!data?.list?.length){
    strip.innerHTML=`<p style="color:var(--txt-muted);font-size:.85rem;grid-column:1/-1;text-align:center;padding:20px">Forecast unavailable.</p>`;
    return;
  }
  const byDate={};
  for(const e of data.list){
    const date=e.dt_txt.split(' ')[0], hour=parseInt(e.dt_txt.split(' ')[1]);
    if(!byDate[date]||Math.abs(hour-12)<Math.abs(parseInt(byDate[date].dt_txt.split(' ')[1])-12)) byDate[date]=e;
  }
  strip.innerHTML=Object.values(byDate).slice(0,5).map(d=>{
    const dt=new Date(d.dt*1000);
    const rain=d.pop!=null?Math.round(d.pop*100):null;
    return `<div class="forecast-day ripple-host">
      <div class="fc-day-name">${dt.toLocaleDateString([],{weekday:'short'}).toUpperCase()}</div>
      <div style="font-size:9px;color:var(--txt-muted);margin-bottom:8px">${dt.toLocaleDateString([],{month:'short',day:'numeric'})}</div>
      <span class="fc-icon">${getWeatherEmoji(d.weather[0]?.description)}</span>
      <div class="fc-temps"><span class="fc-hi">↑ ${fmtTemp(d.main.temp_max,0)}${unitLabel()}</span><span class="fc-lo">↓ ${fmtTemp(d.main.temp_min,0)}${unitLabel()}</span></div>
      <div class="fc-desc">${d.weather[0]?.description??''}</div>
      ${rain!=null?`<div class="fc-rain">💧 ${rain}%</div>`:''}
    </div>`;
  }).join('');
}

/* ──────────────────────────────────────────────────────────
   VERDICT ENGINE
   ────────────────────────────────────────────────────────── */
function buildVerdict(aqi, tempC, weatherDesc) {
  const desc=(weatherDesc??'').toLowerCase();
  const storm=/thunderstorm|tornado|squall|heavy.*rain|extreme.*rain/.test(desc);
  const smog=/smoke|dust|ash|haze/.test(desc);
  const vCold=tempC<0,cold=tempC>=0&&tempC<10,vHot=tempC>42,hot=tempC>=35&&tempC<=42;

  if(aqi>100||storm||vCold||vHot) return {type:'avoid',emoji:'🚫',pillClass:'avoid',
    heading:storm?'Dangerous Weather — Stay Indoors':aqi>100?'Poor Air Quality — Limit Outdoor Exposure':'Extreme Temperature — Precautions Required',
    summary:storm?`⚡ Severe weather: "${capit(weatherDesc)}" detected. Remain indoors and monitor emergency channels.`
      :aqi>200?`🫁 Air classified ${getAqiLevel(aqi).label} (AQI ${aqi}). PM₂.₅ is at hazardous levels. Stay indoors.`
      :aqi>100?`🌫 Air Quality Unhealthy (AQI ${aqi}). Wear N95 and limit outdoor time for all groups.`
      :vCold?`🥶 Dangerous ${fmtTemp(tempC,0)}${unitLabel()} — frostbite risk high. Stay warm indoors.`
      :`🥵 ${fmtTemp(tempC,0)}${unitLabel()} — heatstroke risk elevated. Avoid sun exposure.`,
    recs:storm?[{icon:'🏠',txt:'Stay indoors away from windows.'},{icon:'📱',txt:'Enable emergency weather alerts.'},{icon:'🚗',txt:'Avoid driving — roads may flood.'},{icon:'🔋',txt:'Charge devices and prepare emergency kit.'}]
      :aqi>150?[{icon:'😷',txt:'Wear certified N95/P100 respirator outdoors.'},{icon:'🏠',txt:'Seal windows; use HEPA air purifiers.'},{icon:'🚫',txt:'Cancel all outdoor activities.'},{icon:'💊',txt:'Consult doctor if you have respiratory conditions.'}]
      :[{icon:'😷',txt:'Wear N95 mask; limit outdoor to under 1 hour.'},{icon:'🧴',txt:'Shower after outdoor exposure to remove particles.'},{icon:'👁️',txt:'Rinse eyes if irritated; avoid face-touching.'},{icon:'🏠',txt:'Keep windows closed; use air filtration.'}],
    glowColor:'#ff2d6b',
    seasonTip:'🚫 Not advisable to visit right now. Plan for milder conditions.',
  };

  if((aqi>50&&aqi<=100)||hot||smog||cold) return {type:'moderate',emoji:'⚠️',pillClass:'moderate',
    heading:hot?'Travel with Caution — Stay Hydrated':cold?'Cool Conditions — Dress Warmly':'Moderate Conditions — Precautions Advised',
    summary:hot?`🌡️ ${fmtTemp(tempC,0)}${unitLabel()} — manageable but tiring. Plan outdoor activities for early morning or evening.`
      :cold?`🧥 ${fmtTemp(tempC,0)}${unitLabel()} — chilly but safe with proper clothing.`
      :`🌤 Moderate AQI (${aqi}). Healthy adults are fine; sensitive groups limit prolonged outdoor stay.`,
    recs:hot?[{icon:'💧',txt:'Drink 2–3 litres of water throughout the day.'},{icon:'🧢',txt:'Wear sunhat, UV sunglasses, and light clothing.'},{icon:'🕑',txt:'Plan outdoor trips for 7–10 AM or after sunset.'},{icon:'🏖️',txt:'Apply SPF 50+ sunscreen every 2 hours.'}]
      :cold?[{icon:'🧥',txt:'Layer up: thermal, insulating mid-layer, windproof outer.'},{icon:'🧤',txt:'Protect extremities: gloves, hat, scarf.'},{icon:'☕',txt:'Keep warm beverages handy.'},{icon:'🚶',txt:'Stay active to maintain body temperature.'}]
      :[{icon:'😷',txt:'Sensitive individuals wear surgical/FFP2 mask.'},{icon:'🌿',txt:'Choose parks away from traffic corridors.'},{icon:'🏃',txt:'Avoid intense outdoor exercise.'},{icon:'🏠',txt:'Head indoors if you notice any breathing difficulty.'}],
    glowColor:'#ffd60a',
    seasonTip:'🌤 Travel possible with precautions. Check daily AQI before outdoor plans.',
  };

  return {type:'safe',emoji:'✅',pillClass:'safe',
    heading:'Excellent Conditions — Explore Freely!',
    summary:`🌟 Everything checks out! AQI is ${getAqiLevel(aqi).label} (${aqi}), temperature a comfortable ${fmtTemp(tempC,0)}${unitLabel()} with "${capit(weatherDesc)}" skies. Perfect day to explore the city.`,
    recs:[{icon:'🗺️',txt:'Perfect for sightseeing — explore landmarks and hidden gems.'},{icon:'🚴',txt:'Cycle or walk for a more immersive local experience.'},{icon:'📸',txt:'Great lighting for photography — seek golden hour spots.'},{icon:'💧',txt:'Stay hydrated; carry a reusable water bottle.'}],
    glowColor:'#00e5ff',
    seasonTip:"✅ Great time to visit! Book your trip and enjoy ideal conditions.",
  };
}

function renderVerdict(v) {
  setText('verdictEmoji',   v.emoji);
  setText('verdictHeading', v.heading);
  setText('verdictSummary', v.summary);
  setCss('verdictGlow','background', v.glowColor);
  const pill=$('verdictPill');
  if(pill){pill.className=`verdict-pill ${v.pillClass}`;pill.textContent=v.type.toUpperCase();}
  setHtml('recList', v.recs.map(r=>`<li class="rec-item"><span class="rec-icon">${r.icon}</span><span>${r.txt}</span></li>`).join(''));
  if(v.seasonTip) setText('seasonTipText', v.seasonTip);
}

/* ──────────────────────────────────────────────────────────
   SHARE / COPY
   ────────────────────────────────────────────────────────── */
function buildShareText() {
  const city=$('cityName')?.textContent??'This city';
  const verdict=$('verdictPill')?.textContent??'—';
  const temp=$('tempVal')?.textContent??'—';
  const unit_=$('tempUnit')?.textContent??'°C';
  const aqi=$('aqiNum')?.textContent??'—';
  const aqiLvl=$('aqiStatus')?.textContent??'—';
  const heading=$('verdictHeading')?.textContent??'—';
  const summary=$('verdictSummary')?.textContent??'—';
  const recs=[...($('recList')?.querySelectorAll('.rec-item')??[])].map(el=>'• '+el.textContent.trim()).join('\n');
  const tip=$('seasonTipText')?.textContent??'';
  return [`🧭 Smart Travel Verdict — ${city}`,'',`Status: ${verdict}`,`🌡 Temp: ${temp}${unit_}  ·  🫁 AQI: ${aqi} (${aqiLvl})`,'',heading,'',summary,'',`💡 Recommendations:`,recs,'',`📌 ${tip}`,'','— Smart Travel Analyzer'].join('\n');
}

async function copyToClipboard(text, btnId, labelId, successText) {
  try {
    await navigator.clipboard.writeText(text);
    const btn=$(btnId); setText(labelId, successText);
    btn?.classList.add(btnId==='copyBtn'?'copied':'shared');
    setTimeout(()=>{btn?.classList.remove('copied','shared');setText(labelId,btnId==='copyBtn'?'Copy':'Share');},2500);
  } catch { showError('Clipboard access denied.'); }
}

function setupShareBtn() {
  $('shareBtn')?.addEventListener('click',async()=>{
    const text=buildShareText();
    if(navigator.share){try{await navigator.share({title:'Smart Travel Verdict',text});return;}catch{}}
    copyToClipboard(text,'shareBtn','shareLabel','✓ Copied!');
  });
}
function setupCopyBtn() {
  $('copyBtn')?.addEventListener('click',()=>copyToClipboard(buildShareText(),'copyBtn','copyLabel','✓ Done!'));
}

/* ──────────────────────────────────────────────────────────
   UNIT TOGGLE
   ────────────────────────────────────────────────────────── */
function setupUnitToggle() {
  const btnC=$('btnCelsius'),btnF=$('btnFahrenheit');
  if(!btnC||!btnF) return;
  if(unit==='fahrenheit'){btnF.classList.add('active');btnC.classList.remove('active');}
  const activate=newUnit=>{
    unit=newUnit;
    localStorage.setItem('sta_unit',unit);
    btnC.classList.toggle('active',unit==='celsius');
    btnF.classList.toggle('active',unit==='fahrenheit');
    if(lastWeatherData){
      renderWeather(lastWeatherData);
      if(lastWeatherData._forecast) renderForecast(lastWeatherData._forecast);
      renderVerdict(buildVerdict(lastAQI,lastWeatherData.main.temp,lastWeatherData.weather[0]?.description));
    }
  };
  btnC.addEventListener('click',()=>activate('celsius'));
  btnF.addEventListener('click',()=>activate('fahrenheit'));
}

/* ──────────────────────────────────────────────────────────
   GEOLOCATION
   ────────────────────────────────────────────────────────── */
function setupGeoBtn() {
  const btn=$('geoBtn');
  if(!btn) return;
  btn.addEventListener('click',()=>{
    if(!navigator.geolocation){showError('Geolocation not supported.');return;}
    btn.classList.add('loading');btn.disabled=true;
    navigator.geolocation.getCurrentPosition(
      pos=>{btn.classList.remove('loading');btn.disabled=false;analyzeCity({lat:pos.coords.latitude,lon:pos.coords.longitude});},
      err=>{
        btn.classList.remove('loading');btn.disabled=false;
        const m={1:'Location access denied.',2:'Could not determine position.',3:'Request timed out.'};
        showError(m[err.code]??'Geolocation failed.');
        goToHome();
      },
      {timeout:10000,enableHighAccuracy:true}
    );
  });
}

/* ──────────────────────────────────────────────────────────
   BACK / NEW SEARCH BUTTONS
   ────────────────────────────────────────────────────────── */
function setupNavBtns() {
  $('backBtn')?.addEventListener('click', goToHome);
  $('newSearchBtn')?.addEventListener('click',()=>{
    goToHome();
    setTimeout(()=>{ $('cityInput')?.select(); },450);
  });
  $('errorRetry')?.addEventListener('click',()=>{ if(lastQuery) analyzeCity(lastQuery); });
  $('clearRecent')?.addEventListener('click', clearRecent);
}

/* ──────────────────────────────────────────────────────────
   MAIN — analyzeCity
   ────────────────────────────────────────────────────────── */
async function analyzeCity(query) {
  lastQuery = query;
  showLoading(true);   // ← navigates to results page immediately

  try {
    setStep(1);
    let weather;
    try { weather=await fetchWeather(query); }
    catch {
      const lbl=typeof query==='string'?`"${query}"`:'your location';
      throw new Error(`City ${lbl} not found. Check the spelling or your connection.`);
    }
    if(weather.cod&&weather.cod!==200) throw new Error(weather.message??'City not found.');

    const {lat,lon}=weather.coord;

    setStep(2);
    const [aqR,ctR]=await Promise.allSettled([fetchAirQuality(lat,lon),fetchCountry(weather.sys.country)]);

    setStep(3);
    /* small pause so step 3 is visible */
    await new Promise(r=>setTimeout(r,200));

    setStep(4);
    const forecast=await fetchForecast({lat,lon});

    /* Compute AQI */
    const readings=aqR.status==='fulfilled'?(aqR.value??{}):{};
    const pm25=readings['pm25'];
    let aqi;
    if(pm25!=null) aqi=pm25ToAQI(pm25);
    else{
      const main=(weather.weather[0]?.main??'').toLowerCase();
      if(/thunderstorm/.test(main)) aqi=170;
      else if(/smoke|dust|ash/.test(main)) aqi=140;
      else if(/haze|fog/.test(main)) aqi=90;
      else if(/rain|drizzle/.test(main)) aqi=38;
      else aqi=42;
    }

    /* Cache */
    lastWeatherData={...weather,_forecast:forecast};
    lastAQI=aqi;

    /* Render */
    showResults();
    setBodyTheme(aqi);
    renderCity(weather);
    renderCountry(ctR.status==='fulfilled'?ctR.value:null, weather.sys.country);
    renderWeather(weather);
    renderAQI(aqi,readings);
    renderForecast(forecast);
    renderVerdict(buildVerdict(aqi,weather.main.temp,weather.weather[0]?.description));

    addRecent(weather.name);

  } catch(err) {
    $('loadingSpinner')?.classList.remove('visible');
    showError(err.message??'Unexpected error. Please try again.');
    console.error('[SmartTravel]',err);
  }
}

/* ──────────────────────────────────────────────────────────
   EVENT LISTENERS: SEARCH FORM
   ────────────────────────────────────────────────────────── */
$('searchForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  const city=$('cityInput').value.trim();
  if(city) analyzeCity(city);
});
$('cityInput')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();const city=$('cityInput').value.trim();if(city)analyzeCity(city);}
});

/* ──────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded',()=>{
  setupRipples();
  setupUnitToggle();
  setupGeoBtn();
  setupShareBtn();
  setupCopyBtn();
  setupNavBtns();
  renderRecent();
  $('cityInput')?.focus();

  /* Auto-load last searched city */
  const last=localStorage.getItem(LS_LAST_KEY);
  if(last){ $('cityInput').value=last; analyzeCity(last); }
});
