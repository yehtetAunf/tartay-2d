const times=['05:00 PM','06:00 PM','07:00 PM','08:00 PM','09:00 PM','10:00 PM','11:00 PM','12:00 AM'];
document.querySelector('#rounds').innerHTML=times.map(t=>`<article><b>${t}</b><span>--</span></article>`).join('');
fetch('/api/status').catch(()=>{});
