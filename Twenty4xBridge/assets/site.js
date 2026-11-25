(function(){var b=document.createElement('div');b.id='pl';b.setAttribute('aria-hidden','true');b.innerHTML='<i></i>';document.body.appendChild(b);var i=b.firstChild;
function go(w){i.style.width=w+'%'}
function done(){go(100);b.className='on done';setTimeout(function(){b.className='';go(0)},400)}
b.className='on';go(30);
if(document.readyState==='complete')setTimeout(done,120);else addEventListener('load',function(){setTimeout(done,80)});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target||a.hasAttribute('download'))return;
var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;if(u.pathname===location.pathname&&u.hash)return;
document.body.classList.add('leaving');b.className='on';go(12);setTimeout(function(){go(62)},60);setTimeout(function(){go(85)},700)});
addEventListener('pageshow',function(e){if(e.persisted){document.body.classList.remove('leaving');done()}});})();